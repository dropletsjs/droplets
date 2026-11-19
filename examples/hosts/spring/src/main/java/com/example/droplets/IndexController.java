package com.example.droplets;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriUtils;

/**
 * The basic page: each droplet fetched as an HTML fragment from the droplets
 * server, with `x-droplet-location` set to the origin browsers will use, and
 * pasted into a Thymeleaf template. The page loads `/index.js` once; the
 * elements then hydrate themselves.
 */
@Controller
class IndexController {

  private static final Logger log = LoggerFactory.getLogger(IndexController.class);

  /** The Svelte example's droplets (examples/frameworks/svelte), one per mode. */
  static final List<String> IDS = List.of("client", "ssr-hydrate", "ssr-nohydrate");

  private final RestClient client = Application.restClient(Duration.ofSeconds(10));
  private final ExecutorService executor;

  /** Server-to-server address (inside Docker: the service name). */
  private final String internalUrl;

  /** Browser-facing address, written onto every fragment. */
  private final String dropletsPublicUrl;

  IndexController(
      ExecutorService executor,
      @Value("${DROPLETS_INTERNAL_URL:http://localhost:8000}") String internalUrl,
      @Value("${DROPLETS_PUBLIC_URL:http://localhost:8000}") String dropletsPublicUrl) {
    this.executor = executor;
    this.internalUrl = internalUrl;
    this.dropletsPublicUrl = dropletsPublicUrl;
  }

  @GetMapping("/")
  String index(@RequestParam(defaultValue = "Spring Boot") String who, Model model) {
    List<CompletableFuture<String>> pending =
        IDS.stream().map(id -> CompletableFuture.supplyAsync(() -> fetchDroplet(id, who), executor)).toList();
    model.addAttribute("dropletsPublicUrl", dropletsPublicUrl);
    model.addAttribute("fragments", pending.stream().map(CompletableFuture::join).toList());
    return "index";
  }

  /** GET /droplets/<id>?who= → the droplet element's fragment, or an inline error. */
  private String fetchDroplet(String droplet, String who) {
    URI uri =
        URI.create(
            internalUrl
                + "/droplets/"
                + UriUtils.encodePathSegment(droplet, StandardCharsets.UTF_8)
                + "?who="
                + UriUtils.encodeQueryParam(who, StandardCharsets.UTF_8));
    try {
      return client
          .get()
          .uri(uri)
          .header("accept", "text/html")
          .header("x-droplet-location", dropletsPublicUrl)
          .exchange(
              (req, res) -> {
                int status = res.getStatusCode().value();
                String type = res.getHeaders().getFirst("content-type");
                // Only an HTML answer is a fragment (a 500 or 504 carries the droplet's
                // error page); anything else may echo the props, so it is never pasted.
                if ((res.getStatusCode().is2xxSuccessful() || status == 500 || status == 504) && type != null && type.startsWith("text/html")) {
                  return new String(res.getBody().readAllBytes(), StandardCharsets.UTF_8);
                }
                return "<p class=\"error\">droplet \"" + HtmlUtils.htmlEscape(droplet) + "\" unavailable: HTTP " + status + "</p>";
              });
    } catch (RuntimeException error) {
      // The error names the internal URL: it goes to the log, not the page.
      log.warn("[droplets] {}: {}", droplet, error.toString());
      return "<p class=\"error\">droplet \"" + HtmlUtils.htmlEscape(droplet) + "\" unavailable</p>";
    }
  }
}
