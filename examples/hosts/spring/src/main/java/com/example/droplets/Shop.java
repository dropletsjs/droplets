package com.example.droplets;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriUtils;

/**
 * The shop demo (examples/shop) as this host reaches it: its fragments, fetched
 * on the server as the browser's request, and the helpers the pages and the
 * proxy share. The contract they follow is examples/shop/CONTRACT.md.
 */
@Component
public class Shop {

  private static final Logger log = LoggerFactory.getLogger(Shop.class);

  /** The stack this host is, in the footer: the one thing that differs between hosts. */
  static final String STACK = "Spring Boot";

  /** What the browser's request may tell the shop; nothing that names a host. `cookie` goes on filtered. */
  static final List<String> FORWARDED_REQUEST_HEADERS =
      List.of(
          "accept",
          "accept-language",
          "content-type",
          "if-none-match",
          "origin",
          "referer",
          "user-agent",
          "x-droplet-props",
          "x-droplets-build");

  /** The shop's own cookies, the only ones it is sent: another app's on this origin stay here. */
  static final Set<String> SHOP_COOKIES = Set.of("cart_id", "shop_admin");

  /** One query parameter, as the page's URL had it. */
  public record Param(String key, String value) {}

  /** A droplet a page asks for, with its props. */
  public record Wanted(String droplet, List<Param> params) {}

  /**
   * A fragment's answer: the HTML to insert (the shop's own markup, or an
   * escaped "unavailable" note), its status, a redirect's `location`, its
   * `Set-Cookie` headers and its `Link` header.
   */
  public record Fragment(String html, int status, String location, List<String> cookies, String link) {}

  private final RestClient client;
  private final ExecutorService executor;

  /** How this process reaches the shop (`http://shop:8300` in Docker). */
  final String internalUrl;

  /**
   * This host's own public origin. It goes out as `x-droplet-location` on every
   * request to the shop, written out in the environment: never the client's Host.
   */
  final String origin;

  Shop(
      RestClient client,
      ExecutorService executor,
      @Value("${SHOP_INTERNAL_URL:http://localhost:8300}") String internalUrl,
      @Value("${SHOP_PUBLIC_URL:http://localhost:8016}") String publicUrl) {
    this.client = client;
    this.executor = executor;
    this.internalUrl = internalUrl.replaceAll("/+$", "");
    URI pub = URI.create(publicUrl);
    this.origin = pub.getScheme() + "://" + pub.getRawAuthority();
  }

  // ---- Request helpers ----------------------------------------------------------

  /** The request's path and query exactly as the browser sent them (Tomcat leaves both undecoded). */
  static String rawTarget(HttpServletRequest request) {
    String query = request.getQueryString();
    return query == null ? request.getRequestURI() : request.getRequestURI() + "?" + query;
  }

  /** The browser's `Cookie` header with the shop's cookies only, or null. */
  static String shopCookies(String header) {
    if (header == null) return null;
    List<String> kept = new ArrayList<>();
    for (String pair : header.split(";")) {
      String trimmed = pair.trim();
      if (SHOP_COOKIES.contains(trimmed.split("=", 2)[0].trim())) kept.add(trimmed);
    }
    return kept.isEmpty() ? null : String.join("; ", kept);
  }

  /** A `.` or `..` segment, once decoded: never a shop route. */
  static boolean hasDotSegment(String rawPath) {
    for (String segment : rawPath.split("/", -1)) {
      String decoded = decode(segment.replace("+", "%2B"));
      if (decoded.equals(".") || decoded.equals("..")) return true;
    }
    return false;
  }

  /** A raw query string as `[key, value]` pairs, in order, repeated keys kept. */
  static List<Param> query(String raw) {
    List<Param> pairs = new ArrayList<>();
    if (raw == null || raw.isEmpty()) return pairs;
    for (String piece : raw.split("&")) {
      if (piece.isEmpty()) continue;
      String[] kv = piece.split("=", 2);
      pairs.add(new Param(decode(kv[0]), kv.length > 1 ? decode(kv[1]) : ""));
    }
    return pairs;
  }

  /** The query parameters named in `keys`, in that order. */
  static List<Param> pick(List<Param> query, List<String> keys) {
    List<Param> picked = new ArrayList<>();
    for (String key : keys) {
      for (Param param : query) {
        if (param.key().equals(key)) picked.add(param);
      }
    }
    return picked;
  }

  /** `[key, value]` pairs → a query string, every piece encoded. */
  static String encodeQuery(List<Param> params) {
    return params.stream()
        .map(p -> URLEncoder.encode(p.key(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(p.value(), StandardCharsets.UTF_8))
        .collect(Collectors.joining("&"));
  }

  /** Form decoding, a malformed escape left as it was. */
  private static String decode(String value) {
    try {
      return URLDecoder.decode(value, StandardCharsets.UTF_8);
    } catch (IllegalArgumentException malformed) {
      return value;
    }
  }

  // ---- Fragments ----------------------------------------------------------------

  /**
   * Every droplet in `wanted`, at once, as the browser's request: its shop
   * cookies, this page as the `Referer`. In the order asked.
   */
  List<Fragment> fragments(HttpServletRequest request, List<Wanted> wanted) {
    String target = rawTarget(request);
    String cookie = shopCookies(request.getHeader("cookie"));
    List<CompletableFuture<Fragment>> pending =
        wanted.stream()
            .map(w -> CompletableFuture.supplyAsync(() -> fragment(target, cookie, w.droplet(), w.params()), executor))
            .toList();
    return pending.stream().map(CompletableFuture::join).toList();
  }

  /**
   * `GET /droplets/<id>?<params>`. Only an HTML answer is a fragment (a 500
   * carries the droplet's error page); anything else may echo the props, so
   * it is never inserted.
   */
  Fragment fragment(String target, String cookie, String droplet, List<Param> params) {
    URI uri = URI.create(internalUrl + "/droplets/" + UriUtils.encodePathSegment(droplet, StandardCharsets.UTF_8) + "?" + encodeQuery(params));
    try {
      return client
          .get()
          .uri(uri)
          .headers(
              headers -> {
                headers.set("accept", "text/html");
                headers.set("x-droplet-location", origin);
                headers.set("referer", origin + target);
                if (cookie != null) headers.set("cookie", cookie);
              })
          .exchange(
              (req, res) -> {
                int status = res.getStatusCode().value();
                List<String> cookies = List.copyOf(res.getHeaders().getOrEmpty("set-cookie"));
                String link = res.getHeaders().getFirst("link");
                String type = res.getHeaders().getFirst("content-type");
                boolean html = type != null && type.startsWith("text/html");
                if (status >= 300 && status < 400) {
                  return new Fragment(unavailable(droplet, "HTTP " + status), status, res.getHeaders().getFirst("location"), cookies, link);
                }
                if (((status >= 200 && status < 300) || status == 500) && html) {
                  // Trusted markup from the shop: inserted as it is.
                  return new Fragment(new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8), status, null, cookies, link);
                }
                return new Fragment(unavailable(droplet, "HTTP " + status), status, null, cookies, link);
              });
    } catch (RuntimeException error) {
      log.warn("[shop] {}: {}", droplet, error.toString());
      return new Fragment(unavailable(droplet, "unreachable"), 502, null, List.of(), null);
    }
  }

  private static String unavailable(String droplet, String reason) {
    return "<p class=\"shop-unavailable\">The " + HtmlUtils.htmlEscape(droplet) + " droplet is unavailable (" + reason + ").</p>";
  }

  /** A product's name, category and id, from the product page's public `_data` read; null when not found. */
  Map<String, Object> product(String slug) {
    URI uri = URI.create(internalUrl + "/droplets/product-page/_data?" + encodeQuery(List.of(new Param("slug", slug))));
    Map<?, ?> body;
    try {
      body =
          client
              .get()
              .uri(uri)
              .header("x-droplet-location", origin)
              .header("accept", "application/json")
              .exchange((req, res) -> res.getStatusCode().is2xxSuccessful() ? res.bodyTo(Map.class) : null);
    } catch (RuntimeException error) {
      return null;
    }
    if (body == null || !(body.get("data") instanceof Map<?, ?> data) || !(data.get("product") instanceof Map<?, ?> found)) return null;
    if (!(found.get("id") instanceof String) || !(found.get("name") instanceof String)) return null;
    Map<String, Object> product = new LinkedHashMap<>();
    found.forEach((key, value) -> product.put(String.valueOf(key), value));
    return product;
  }

  private static final Pattern LINK = Pattern.compile("^\\s*<([^>]*)>(.*)$", Pattern.DOTALL);

  /** The fragments' `Link` preloads, for the page's head: on this host's origin only. */
  List<Map<String, String>> linkTags(List<Fragment> fragments) {
    List<Map<String, String>> tags = new ArrayList<>();
    for (Fragment fragment : fragments) {
      if (fragment.link() == null) continue;
      for (String part : fragment.link().split(",(?=\\s*<)")) {
        Matcher match = LINK.matcher(part);
        if (!match.matches()) continue;
        Map<String, String> params = new LinkedHashMap<>();
        for (String param : match.group(2).split(";")) {
          String[] kv = param.split("=", 2);
          String key = kv[0].trim().toLowerCase();
          String value = kv.length > 1 ? kv[1].trim().replaceAll("^\"|\"$", "") : "";
          if (!key.isEmpty() && !value.isEmpty()) params.put(key, value);
        }
        String rel = params.get("rel");
        String href = match.group(1);
        if (!("preload".equals(rel) || "modulepreload".equals(rel)) || !href.startsWith(origin + "/")) continue;
        Map<String, String> tag = new LinkedHashMap<>();
        tag.put("rel", rel);
        tag.put("href", href);
        tag.put("as", params.get("as"));
        if (!tags.contains(tag)) tags.add(tag);
      }
    }
    return tags;
  }
}
