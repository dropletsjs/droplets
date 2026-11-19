package com.example.droplets;

import com.example.droplets.Shop.Fragment;
import com.example.droplets.Shop.Param;
import com.example.droplets.Shop.Wanted;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.servlet.ModelAndView;

/**
 * The shop's four pages: each fetches its fragments on the server, all at
 * once, and composes them in one Thymeleaf layout (`templates/shop/`).
 */
@Controller
class ShopPages {

  private final Shop shop;

  ShopPages(Shop shop) {
    this.shop = shop;
  }

  @GetMapping("/gallery")
  ModelAndView gallery(HttpServletRequest request, HttpServletResponse response) {
    // The whole query to both: the shop drops what a droplet does not take.
    List<Param> query = Shop.query(request.getQueryString());
    return render(
        request,
        response,
        new Page("shop/gallery", "Gallery", "/gallery", HttpStatus.OK, Map.of()),
        List.of(new Wanted("product-filter", query), new Wanted("product-library", query)));
  }

  @GetMapping("/product/{slug}")
  ModelAndView product(@PathVariable String slug, HttpServletRequest request, HttpServletResponse response) {
    Map<String, Object> found = shop.product(slug);
    if (found == null) {
      return render(request, response, new Page("shop/not-found", "Not found", null, HttpStatus.NOT_FOUND, Map.of()), List.of());
    }
    List<Param> query = Shop.query(request.getQueryString());
    List<Param> comments = new ArrayList<>(Shop.pick(query, List.of("order", "page", "showing")));
    comments.add(new Param("productId", (String) found.get("id")));
    // `v`, when the link had one: the shop serves its build's page for the
    // current version and redirects an old one to this URL without it.
    List<Param> page = new ArrayList<>(List.of(new Param("slug", String.valueOf(found.getOrDefault("slug", slug)))));
    page.addAll(Shop.pick(query, List.of("v")));
    Object category = found.get("category") instanceof Map<?, ?> map ? map : Map.of();
    return render(
        request,
        response,
        new Page("shop/product", (String) found.get("name"), null, HttpStatus.OK, Map.of("product", found, "category", category)),
        List.of(new Wanted("product-page", page), new Wanted("product-comments", comments)));
  }

  @GetMapping("/login")
  ModelAndView login(HttpServletRequest request, HttpServletResponse response) {
    List<Param> next = Shop.pick(Shop.query(request.getQueryString()), List.of("next"));
    return render(
        request, response, new Page("shop/login", "Log in", null, HttpStatus.OK, Map.of()), List.of(new Wanted("login", next)));
  }

  @GetMapping("/admin")
  ModelAndView admin(HttpServletRequest request, HttpServletResponse response) {
    List<Param> props = Shop.pick(Shop.query(request.getQueryString()), List.of("view", "id"));
    return render(
        request,
        response,
        new Page("shop/admin", "Admin", "/admin", HttpStatus.OK, Map.of()),
        List.of(new Wanted("product-admin", props)));
  }

  /** A page's template, its title, the nav link it is (or null), its status and its own values. */
  private record Page(String view, String title, String current, HttpStatus status, Map<String, Object> values) {}

  /**
   * Fetches the toasts (first in the body), the header's cart and the page's
   * fragments, then answers: a droplet's redirect as it is, otherwise the
   * page, with every `Set-Cookie` the fragments sent.
   */
  private ModelAndView render(HttpServletRequest request, HttpServletResponse response, Page page, List<Wanted> wanted) {
    List<Wanted> all = new ArrayList<>();
    all.add(new Wanted("toast-center", List.of()));
    all.add(new Wanted("shopping-cart", List.of(new Param("variant", "badge"))));
    all.addAll(wanted);
    List<Fragment> results = shop.fragments(request, all);

    // Rendered with the visitor's cookies: never stored anywhere.
    response.setHeader("cache-control", "private, no-store");
    // Untouched: the shop never sets Domain, so they belong to this origin.
    results.forEach(result -> result.cookies().forEach(cookie -> response.addHeader("set-cookie", cookie)));
    for (Fragment result : results) {
      if (result.location() != null) {
        response.setStatus(result.status());
        response.setHeader("location", result.location());
        return null;
      }
    }

    Map<String, Object> model = new HashMap<>(page.values());
    model.put("stack", Shop.STACK);
    model.put("title", page.title());
    model.put("current", page.current());
    model.put("links", shop.linkTags(results));
    model.put("toasts", results.get(0).html());
    model.put("cart", results.get(1).html());
    model.put("fragments", results.subList(2, results.size()).stream().map(Fragment::html).toList());
    return new ModelAndView(page.view(), model, page.status());
  }
}
