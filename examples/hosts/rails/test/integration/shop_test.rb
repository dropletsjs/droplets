require "test_helper"

class ShopProxyTest < ActionDispatch::IntegrationTest
  test "refuses a body over the limit before the shop is asked" do
    with_shop(->(*) { flunk "the shop was asked" }) do |seen|
      post "/droplets/login", params: "x" * (Shop::MAX_BODY + 1), headers: { "content-type" => "application/x-www-form-urlencoded" }
      assert_response 413
      assert_equal "The body is too large.", response.body
      assert_empty seen
    end
  end

  test "sends its own origin, the listed headers and the shop's cookies only" do
    with_shop(->(*) { shop_answer(200, { "content-type" => "application/json" }, "{}") }) do |seen|
      get "/api/cart?x=1", headers: {
        "host" => "evil.example", "x-forwarded-host" => "evil.example", "x-droplet-location" => "https://evil.example",
        "authorization" => "Bearer secret", "accept" => "application/json",
        "cookie" => "other=1; cart_id=abc; shop_admin=s",
      }
      assert_response 200
      sent = seen.sole
      assert_equal "/api/cart?x=1", sent[:target]
      assert_equal Shop::ORIGIN, sent[:headers]["x-droplet-location"]
      assert_equal "cart_id=abc; shop_admin=s", sent[:headers]["cookie"]
      assert_equal %w[accept cookie x-droplet-location], sent[:headers].keys.sort
    end
  end

  test "passes the body on, and every Set-Cookie, without hop-by-hop headers" do
    answer = shop_answer(303, { "location" => "/admin", "set-cookie" => ["a=1; Path=/", "b=2; Path=/"], "connection" => "close" })
    with_shop(->(*) { answer }) do |seen|
      post "/droplets/login?/login", params: "user=admin&password=x", headers: { "content-type" => "application/x-www-form-urlencoded" }
      assert_equal "user=admin&password=x", seen.sole[:body]
      assert_response 303
      assert_equal "/admin", response.headers["location"]
      assert_equal ["a=1; Path=/", "b=2; Path=/"], Array(response.headers["set-cookie"]).flat_map { |value| value.split("\n") }
      assert_nil response.headers["connection"]
    end
  end

  test "refuses a dot segment before the shop is asked" do
    with_shop(->(*) { flunk "the shop was asked" }) do |seen|
      get "/api/%2e%2e/health"
      assert_response 400
      get "/assets/./x"
      assert_response 400
      assert_empty seen
    end
  end

  test "answers 502 when the shop is unreachable" do
    with_shop(->(*) { raise Errno::ECONNREFUSED }) do
      get "/index.js"
      assert_response 502
      assert_equal "The shop is unreachable.", response.body
    end
  end
end

class ShopPagesTest < ActionDispatch::IntegrationTest
  test "inserts only an HTML fragment, never what another answer echoes" do
    shop = lambda do |_method, target, *|
      if target.start_with?("/droplets/login?")
        shop_answer(400, { "content-type" => "application/json" }, %({"error":"<script>alert(1)</script>"}))
      else
        shop_answer(200, { "content-type" => "text/html" }, "<djs-shop>ok</djs-shop>")
      end
    end
    with_shop(shop) do
      get "/login?next=%2Fadmin"
      assert_response 200
      assert_equal "private, no-store", response.headers["cache-control"]
      assert_includes response.body, "<djs-shop>ok</djs-shop>"
      assert_includes response.body, %(<p class="shop-unavailable">The login droplet is unavailable (HTTP 400).</p>)
      assert_not_includes response.body, "<script>alert(1)</script>"
    end
  end

  test "answers a fragment's redirect with its status, never following it" do
    shop = lambda do |_method, target, *|
      if target.start_with?("/droplets/product-admin?")
        shop_answer(302, { "location" => "https://elsewhere.example/" })
      else
        shop_answer(200, { "content-type" => "text/html" }, "<djs-shop></djs-shop>")
      end
    end
    with_shop(shop) do |seen|
      get "/admin"
      assert_response 302
      assert_equal "https://elsewhere.example/", response.headers["location"]
      assert_equal 3, seen.size
    end
  end

  test "sends the page's own URL as the referer, on this host's origin" do
    with_shop(->(*) { shop_answer(200, { "content-type" => "text/html" }, "") }) do |seen|
      get "/gallery?q=mug&sort=new", headers: { "host" => "evil.example" }
      library = seen.find { |sent| sent[:target].start_with?("/droplets/product-library?") }
      assert_equal "/droplets/product-library?q=mug&sort=new", library[:target]
      assert_equal "#{Shop::ORIGIN}/gallery?q=mug&sort=new", library[:headers]["referer"]
      assert_equal Shop::ORIGIN, library[:headers]["x-droplet-location"]
    end
  end

  test "answers 404 for a product the shop does not have" do
    with_shop(->(*) { shop_answer(404, { "content-type" => "application/json" }, "{}") }) do
      get "/product/nothing-here"
      assert_response 404
      assert_includes response.body, "This product does not exist."
    end
  end
end
