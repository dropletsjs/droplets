package com.example.droplets;

import static org.springframework.web.bind.annotation.RequestMethod.DELETE;
import static org.springframework.web.bind.annotation.RequestMethod.GET;
import static org.springframework.web.bind.annotation.RequestMethod.HEAD;
import static org.springframework.web.bind.annotation.RequestMethod.OPTIONS;
import static org.springframework.web.bind.annotation.RequestMethod.PATCH;
import static org.springframework.web.bind.annotation.RequestMethod.POST;
import static org.springframework.web.bind.annotation.RequestMethod.PUT;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * A same-origin proxy for what the browser asks the shop for, so its cookies
 * (the cart, the admin session) are first-party and nothing is cross-origin.
 */
@Controller
class ShopProxy {

  private static final Logger log = LoggerFactory.getLogger(ShopProxy.class);

  /** Above the shop's own largest body (a 3 MB admin form with its image). */
  static final int MAX_BODY_BYTES = 4 * 1024 * 1024;

  /**
   * Per hop (RFC 9110 §7.6.1), re-counted by Tomcat (`content-length`), or set
   * apart (`set-cookie`, which may come more than once).
   */
  static final Set<String> DROPPED_RESPONSE_HEADERS =
      Set.of(
          "connection",
          "keep-alive",
          "proxy-authenticate",
          "proxy-authorization",
          "proxy-connection",
          "te",
          "trailer",
          "transfer-encoding",
          "upgrade",
          "content-length",
          "set-cookie");

  private final RestClient client;
  private final String internalUrl;
  private final String origin;

  ShopProxy(RestClient client, Shop shop) {
    this.client = client;
    this.internalUrl = shop.internalUrl;
    this.origin = shop.origin;
  }

  @RequestMapping(
      path = {"/index.js", "/env.js", "/index.css", "/droplets/**", "/assets/**", "/api/**"},
      method = {GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS})
  void proxy(HttpServletRequest request, HttpServletResponse response) throws IOException {
    if (Shop.hasDotSegment(request.getRequestURI())) {
      plain(response, 400, "Bad request.");
      return;
    }
    URI target;
    try {
      // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
      target = new URI(internalUrl + Shop.rawTarget(request));
    } catch (URISyntaxException malformed) {
      plain(response, 400, "Bad request.");
      return;
    }
    HttpMethod method = HttpMethod.valueOf(request.getMethod());

    // Read whole, up to the limit, before anything goes to the shop.
    byte[] body = null;
    if (method != HttpMethod.GET && method != HttpMethod.HEAD) {
      if (request.getContentLengthLong() > MAX_BODY_BYTES) {
        plain(response, 413, "Payload too large.");
        return;
      }
      body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
      if (body.length > MAX_BODY_BYTES) {
        plain(response, 413, "Payload too large.");
        return;
      }
    }

    RestClient.RequestBodySpec upstream =
        client
            .method(method)
            .uri(target)
            .headers(
                headers -> {
                  headers.set("x-droplet-location", origin);
                  for (String name : Shop.FORWARDED_REQUEST_HEADERS) {
                    String value = request.getHeader(name);
                    if (value != null && !value.isEmpty()) headers.set(name, value);
                  }
                  String cookie = Shop.shopCookies(request.getHeader("cookie"));
                  if (cookie != null) headers.set("cookie", cookie);
                });
    if (body != null && (body.length > 0 || request.getContentType() != null)) upstream.body(body);

    try {
      upstream.exchange(
          (req, res) -> {
            response.setStatus(res.getStatusCode().value());
            // And whatever the shop's `Connection` names as per hop.
            Set<String> dropped = new HashSet<>(DROPPED_RESPONSE_HEADERS);
            for (String value : res.getHeaders().getOrEmpty("connection")) {
              for (String name : value.split(",")) dropped.add(name.trim().toLowerCase(Locale.ROOT));
            }
            res.getHeaders()
                .forEach(
                    (name, values) -> {
                      if (!dropped.contains(name.toLowerCase(Locale.ROOT))) values.forEach(value -> response.addHeader(name, value));
                    });
            // Untouched: the shop never sets Domain, so they belong to this origin.
            res.getHeaders().getOrEmpty("set-cookie").forEach(cookie -> response.addHeader("set-cookie", cookie));
            if (method != HttpMethod.HEAD) res.getBody().transferTo(response.getOutputStream());
            return null;
          });
    } catch (RestClientException | UncheckedIOException error) {
      log.warn("[shop proxy] {} {}: {}", method, request.getRequestURI(), error.toString());
      if (!response.isCommitted()) {
        response.reset();
        plain(response, 502, "The shop is unreachable.");
      }
    }
  }

  /** An error as a status and a message, nothing else. */
  static void plain(HttpServletResponse response, int status, String message) throws IOException {
    response.setStatus(status);
    response.setContentType("text/plain;charset=utf-8");
    response.getOutputStream().write(message.getBytes(StandardCharsets.UTF_8));
  }
}
