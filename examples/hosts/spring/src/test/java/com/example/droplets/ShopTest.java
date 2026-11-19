package com.example.droplets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.droplets.Shop.Fragment;
import com.example.droplets.Shop.Param;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** What this host decides itself, before or after the shop answers. */
class ShopTest {

  /** Nothing listens there: every upstream call fails. */
  private final Shop shop =
      new Shop(Application.restClient(Duration.ofSeconds(1)), Executors.newVirtualThreadPerTaskExecutor(), "http://127.0.0.1:9/", "http://localhost:8016/some/path");

  private final MockMvc proxy =
      MockMvcBuilders.standaloneSetup(new ShopProxy(Application.restClient(Duration.ofSeconds(1)), shop)).build();

  @Test
  void takesItsOriginFromTheConfiguredUrlAlone() {
    assertThat(shop.origin).isEqualTo("http://localhost:8016");
    assertThat(shop.internalUrl).isEqualTo("http://127.0.0.1:9");
  }

  @Test
  void sendsTheShopOnlyItsOwnCookies() {
    assertThat(Shop.shopCookies("theme=dark; cart_id=abc; xcart_id=no; shop_admin=s.ig")).isEqualTo("cart_id=abc; shop_admin=s.ig");
    assertThat(Shop.shopCookies("theme=dark; session=1")).isNull();
    assertThat(Shop.shopCookies(null)).isNull();
  }

  @Test
  void findsADotSegmentOnlyOnceDecoded() {
    assertThat(Shop.hasDotSegment("/droplets/../api/cart")).isTrue();
    assertThat(Shop.hasDotSegment("/assets/%2e%2E/secret")).isTrue();
    assertThat(Shop.hasDotSegment("/assets/./x")).isTrue();
    assertThat(Shop.hasDotSegment("/assets/app.123.js")).isFalse();
    assertThat(Shop.hasDotSegment("/assets/...")).isFalse();
  }

  @Test
  void keepsTheQueryAsItCameAndPicksOnlyTheNamedKeys() {
    List<Param> query = Shop.query("order=newest&page=2&v=ab&page=3&evil=%zz&__proto__=x&&q=a+b");
    assertThat(query).contains(new Param("evil", "%zz"), new Param("q", "a b"));
    assertThat(Shop.pick(query, List.of("page", "order")))
        .containsExactly(new Param("page", "2"), new Param("page", "3"), new Param("order", "newest"));
    assertThat(Shop.encodeQuery(List.of(new Param("q", "a b&c"), new Param("next", "/admin")))).isEqualTo("q=a+b%26c&next=%2Fadmin");
  }

  @Test
  void keepsOnlyPreloadsOnItsOwnOrigin() {
    String link =
        "<http://localhost:8016/assets/a.js>; rel=modulepreload, <http://elsewhere.test/b.js>; rel=modulepreload,"
            + " <http://localhost:8016/assets/c.css>; rel=\"preload\"; as=style, <http://localhost:8016/x>; rel=stylesheet,"
            + " <http://localhost:8016.evil.test/d.js>; rel=preload";
    List<Map<String, String>> tags = shop.linkTags(List.of(new Fragment("", 200, null, List.of(), link)));
    assertThat(tags.stream().map(tag -> tag.get("href")))
        .containsExactly("http://localhost:8016/assets/a.js", "http://localhost:8016/assets/c.css");
    assertThat(tags.get(1)).containsEntry("rel", "preload").containsEntry("as", "style");
  }

  @Test
  void answersAnUnreachableShopsDropletWithANoteThatEscapesItsId() {
    Fragment fragment = shop.fragment("/gallery", null, "<b>x</b>", List.of());
    assertThat(fragment.status()).isEqualTo(502);
    assertThat(fragment.location()).isNull();
    assertThat(fragment.html()).contains("&lt;b&gt;x&lt;/b&gt;").doesNotContain("<b>");
  }

  @Test
  void refusesADotSegmentBeforeAskingTheShop() throws Exception {
    proxy.perform(get(URI.create("/droplets/%2e%2e/api/cart"))).andExpect(status().isBadRequest()).andExpect(content().string("Bad request."));
  }

  @Test
  void refusesABodyOverTheLimitBeforeAskingTheShop() throws Exception {
    byte[] large = new byte[ShopProxy.MAX_BODY_BYTES + 1];
    proxy
        .perform(post("/droplets/product-card").contentType("application/x-www-form-urlencoded").content(large))
        .andExpect(status().isPayloadTooLarge())
        .andExpect(content().string("Payload too large."));
  }

  @Test
  void answers502WhenTheShopIsDown() throws Exception {
    proxy.perform(get("/api/cart")).andExpect(status().isBadGateway()).andExpect(content().string("The shop is unreachable."));
  }

  @Test
  void routesOnlyTheShopsPaths() throws Exception {
    proxy.perform(get("/admin.php")).andExpect(status().isNotFound());
  }
}
