# The shop demo (examples/shop) on this host, beside the basic page:
#
# - a same-origin proxy for what the browser asks the shop for (`/index.js`,
#   `/droplets/*`, `/assets/*`, `/api/*`), so its cookies are first-party and
#   nothing is cross-origin;
# - four pages (`/gallery`, `/product/:slug`, `/login`, `/admin`) that fetch
#   the shop's fragments on the server and compose them in one layout.
#
# The contract they follow is examples/shop/CONTRACT.md.

require "json"
require "net/http"
require "stringio"
require "uri"

# The stack this host is, in the footer: the one thing that differs between hosts.
SHOP_STACK = "Sinatra 4"

# How this process reaches the shop (`http://shop:8300` in Docker).
SHOP_INTERNAL_URL = ENV.fetch("SHOP_INTERNAL_URL", "http://localhost:8300").sub(%r{/+\z}, "")
SHOP_INTERNAL = URI(SHOP_INTERNAL_URL)
# This host's own public origin. It goes out as `x-host` on every request,
# written out here: never the client's Host.
SHOP_ORIGIN = URI(ENV.fetch("SHOP_PUBLIC_URL", "http://localhost:#{ENV.fetch('PORT', 8002)}")).then do |uri|
  "#{uri.scheme}://#{uri.host}#{":#{uri.port}" unless uri.port == uri.default_port}"
end

# What the browser's request may tell the shop; nothing that names a host.
SHOP_FORWARDED_REQUEST_HEADERS = %w[
  accept accept-language content-type cookie if-none-match origin referer
  user-agent x-droplet-props x-droplets-build
].freeze

# Per hop, or set apart (`set-cookie`, which may come more than once).
SHOP_DROPPED_RESPONSE_HEADERS = %w[
  connection content-encoding content-length keep-alive set-cookie transfer-encoding
].freeze

helpers do
  def h(value)
    Rack::Utils.escape_html(value.to_s)
  end

  # The request's path and query as the browser sent them.
  def shop_raw_target
    query = request.query_string.to_s
    path = request.script_name + request.path_info
    query.empty? ? path : "#{path}?#{query}"
  end

  # A header of the browser's request, by its HTTP name.
  def shop_request_header(name)
    key = name == "content-type" ? "CONTENT_TYPE" : "HTTP_#{name.upcase.tr('-', '_')}"
    value = request.env[key]
    value unless value.nil? || value.empty?
  end

  # One request to the shop. `target` is a path and query: concatenated onto
  # the shop's base, never resolved, so `//elsewhere` stays a path there.
  # Net::HTTP never follows redirects.
  def shop_request(method, target, headers, body = nil)
    request = Net::HTTPGenericRequest.new(method, !body.nil?, method != "HEAD", SHOP_INTERNAL.path + target, headers)
    request["accept-encoding"] = "identity"
    request.body = body if body
    Net::HTTP.start(SHOP_INTERNAL.host, SHOP_INTERNAL.port, open_timeout: 5, read_timeout: 10) do |http|
      http.request(request)
    end
  end

  # Untouched: the shop never sets Domain, so they belong to this origin.
  def shop_set_cookies(cookies)
    response.headers["set-cookie"] = cookies unless cookies.empty?
  end

  def shop_proxy
    headers = { "x-host" => SHOP_ORIGIN }
    SHOP_FORWARDED_REQUEST_HEADERS.each do |name|
      value = shop_request_header(name)
      headers[name] = value if value
    end
    has_body = !%w[GET HEAD].include?(request.request_method)
    # From the start: Sinatra may have read a form body into `params` already.
    request.body.rewind if has_body
    upstream = shop_request(request.request_method, shop_raw_target, headers, has_body ? request.body.read : nil)

    status upstream.code.to_i
    upstream.each_header do |name, value|
      response.headers[name] = value unless SHOP_DROPPED_RESPONSE_HEADERS.include?(name)
    end
    shop_set_cookies(upstream.get_fields("set-cookie") || [])
    body upstream.body.to_s
  rescue StandardError => e
    warn "[shop proxy] #{request.request_method} #{request.path_info}: #{e.message}"
    halt 502, { "content-type" => "text/plain" }, "The shop is unreachable."
  end

  # GET /droplets/<id>?<params> -> { html:, status:, location:, cookies:, link: }.
  # Only an HTML answer is a fragment (a 500 carries the droplet's error
  # page); anything else may echo the props, so it is never inserted.
  def shop_fragment(id, params = [])
    # The browser's request, as the shop should see it: its cookies, this page as the host.
    headers = { "accept" => "text/html", "x-host" => SHOP_ORIGIN, "referer" => SHOP_ORIGIN + shop_raw_target }
    cookie = shop_request_header("cookie")
    headers["cookie"] = cookie if cookie
    target = "/droplets/#{URI.encode_www_form_component(id)}?#{URI.encode_www_form(params)}"
    result = { html: "", status: 502, location: nil, cookies: [], link: nil }
    begin
      response = shop_request("GET", target, headers)
      code = response.code.to_i
      result.merge!(status: code, cookies: response.get_fields("set-cookie") || [], link: response["link"])
      if (300..399).cover?(code)
        result[:location] = response["location"]
      elsif (response.is_a?(Net::HTTPSuccess) || code == 500) && response["content-type"].to_s.start_with?("text/html")
        # Trusted markup from the shop: inserted as it is.
        result[:html] = response.body.to_s.force_encoding("UTF-8")
        return result
      end
    rescue StandardError => e
      warn "[shop] #{id}: #{e.message}"
    end
    reason = result[:status] == 502 ? "unreachable" : "HTTP #{result[:status]}"
    result[:html] = %(<p class="shop-unavailable">The #{h(id)} droplet is unavailable (#{h(reason)}).</p>)
    result
  end

  # A product's name, category and id, from the product page's public `_data` read.
  def shop_product(slug)
    target = "/droplets/product-page/_data?#{URI.encode_www_form(slug: slug)}"
    response = shop_request("GET", target, { "x-host" => SHOP_ORIGIN, "accept" => "application/json" })
    return nil unless response.is_a?(Net::HTTPSuccess)

    found = JSON.parse(response.body.to_s).dig("data", "product")
    found if found.is_a?(Hash) && found["id"].is_a?(String) && found["name"].is_a?(String)
  rescue StandardError
    nil
  end

  # The fragments' `Link` preloads, as tags for the page's head: on the shop's origin only.
  def shop_link_tags(results)
    tags = []
    results.each do |result|
      result[:link].to_s.split(/,(?=\s*<)/).each do |part|
        match = /\A\s*<([^>]*)>(.*)\z/m.match(part)
        next unless match

        params = match[2].split(";").each_with_object({}) do |param, found|
          key, value = param.split("=", 2).map { |piece| piece.to_s.strip.delete_prefix('"').delete_suffix('"') }
          found[key] = value if key && !key.empty? && value && !value.empty?
        end
        next unless %w[preload modulepreload].include?(params["rel"])

        href = URI(match[1]) rescue next
        next unless "#{href.scheme}://#{href.host}#{":#{href.port}" unless href.port == href.default_port}" == SHOP_ORIGIN

        as = params["as"] ? %( as="#{h(params['as'])}") : ""
        tags << %(<link rel="#{params['rel']}" href="#{h(match[1])}"#{as}>)
      end
    end
    tags.uniq.join("\n")
  end

  def shop_query
    URI.decode_www_form(request.query_string.to_s)
  rescue ArgumentError
    []
  end

  # The page's query parameters named in `keys`, in that order.
  def shop_pick(keys)
    query = shop_query
    keys.flat_map { |key| query.select { |name, _| name == key } }
  end

  # Fetches the toasts (first in the body), the header's cart and the page's fragments (in
  # threads, at once), then answers: a droplet's redirect as it is, otherwise
  # the page, with every `Set-Cookie` the fragments sent.
  def shop_render(view, title:, current:, wanted: [], status_code: 200, **locals)
    requests = [["toast-center", []], ["shopping-cart", [%w[variant badge]]], *wanted]
    results = requests.map { |id, params| Thread.new { shop_fragment(id, params) } }.map(&:value)
    toasts, cart, *fragments = results
    response.headers["cache-control"] = "private, no-store"
    shop_set_cookies(results.flat_map { |result| result[:cookies] })
    redirect = results.find { |result| result[:location] }
    halt redirect[:status], { "location" => redirect[:location] }, "" if redirect

    status status_code
    @shop = {
      stack: SHOP_STACK, title: title, current: current, links: shop_link_tags(results), toasts: toasts[:html],
      cart: cart[:html],
    }
    erb :"shop/#{view}", layout: :"shop/layout", locals: { fragments: fragments.map { |f| f[:html] }, **locals }
  end
end

# ---- The proxy ---------------------------------------------------------------

# Sinatra reads a form body into `params` before the route runs, and the
# server's input cannot be rewound; the proxy passes the same body on, so it
# is buffered first. (The shop caps bodies at 3 MB.) Rack::MethodOverride
# would read it even earlier, ahead of any middleware here: it is off.
set :method_override, false

class ShopBufferedInput
  def initialize(app)
    @app = app
  end

  def call(env)
    input = env["rack.input"]
    env["rack.input"] = StringIO.new(input.read.to_s) if input
    @app.call(env)
  end
end
use ShopBufferedInput

SHOP_PROXIED = %r{/(?:index\.js|(?:droplets|assets|api)/.*)}
%i[get post put patch delete options].each do |verb|
  send(verb, SHOP_PROXIED) { shop_proxy }
end

# ---- Pages -------------------------------------------------------------------

get "/gallery" do
  # The whole query to both: the shop drops what a droplet does not take.
  query = shop_query
  shop_render :gallery, title: "Gallery", current: "/gallery",
                        wanted: [["product-filter", query], ["product-library", query]]
end

get "/product/:slug" do
  product = shop_product(params["slug"])
  unless product
    return shop_render(:not_found, title: "Not found", current: nil, status_code: 404)
  end

  comments = shop_pick(%w[order page showing]) + [["productId", product["id"]]]
  # `v`, when the link had one: the shop serves its build's page for the
  # current version and redirects an old one to this URL without it.
  page = [["slug", product["slug"]]] + shop_pick(%w[v])
  shop_render :product, title: product["name"], current: nil,
                        wanted: [["product-page", page], ["product-comments", comments]],
                        product: product, category: product["category"].is_a?(Hash) ? product["category"] : {}
end

get "/login" do
  shop_render :login, title: "Log in", current: nil, wanted: [["login", shop_pick(%w[next])]]
end

get "/admin" do
  shop_render :admin, title: "Admin", current: "/admin", wanted: [["product-admin", shop_pick(%w[view id])]]
end
