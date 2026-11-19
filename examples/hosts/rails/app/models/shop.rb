# The shop demo (examples/shop), as this host talks to it: its fragments for
# ShopController's pages, and one request for ShopProxy. The contract they
# follow is examples/shop/CONTRACT.md.

require "json"
require "net/http"
require "uri"

module Shop
  # The stack this host is, in the footer: the one thing that differs between hosts.
  STACK = "Rails 8"

  # How this process reaches the shop (`http://shop:8300` in Docker).
  INTERNAL = URI(ENV.fetch("SHOP_INTERNAL_URL", "http://localhost:8300").sub(%r{/+\z}, ""))
  # This host's own public origin. It goes out as `x-droplet-location` on every
  # request, written out here: never the client's Host.
  ORIGIN = URI(ENV.fetch("SHOP_PUBLIC_URL", "http://localhost:#{ENV.fetch('PORT', 8015)}")).then do |uri|
    "#{uri.scheme}://#{uri.host}#{":#{uri.port}" unless uri.port == uri.default_port}"
  end

  # What the browser's request may tell the shop; nothing that names a host. `cookie` goes on filtered.
  FORWARDED_REQUEST_HEADERS = %w[
    accept accept-language content-type if-none-match origin referer
    user-agent x-droplet-props x-droplets-build
  ].freeze

  # The shop's own cookies, the only ones it is sent: another app's on this origin stay here.
  COOKIES = %w[cart_id shop_admin].freeze

  # The most a proxied body may weigh: an image of up to 2 MB in a 3 MB form.
  MAX_BODY = 4 * 1024 * 1024

  # Per hop, or set apart (`set-cookie`, which may come more than once).
  DROPPED_RESPONSE_HEADERS = %w[
    connection content-encoding content-length keep-alive set-cookie transfer-encoding
  ].freeze

  module_function

  def helpers
    ActionController::Base.helpers
  end

  # One request to the shop. `target` is a path and query: concatenated onto
  # the shop's base, never resolved, so `//elsewhere` stays a path there.
  # Net::HTTP never follows redirects.
  def request(method, target, headers, body = nil)
    outgoing = Net::HTTPGenericRequest.new(method, !body.nil?, method != "HEAD", INTERNAL.path + target, headers)
    outgoing["accept-encoding"] = "identity"
    outgoing.body = body if body
    Net::HTTP.start(INTERNAL.host, INTERNAL.port, open_timeout: 5, read_timeout: 10) do |http|
      http.request(outgoing)
    end
  end

  # The browser's `Cookie` header with the shop's cookies only, or nil.
  def cookie_header(browser)
    kept = browser.headers["cookie"].to_s.split(";").map(&:strip).select do |pair|
      COOKIES.include?(pair.split("=", 2).first.to_s.strip)
    end
    kept.empty? ? nil : kept.join("; ")
  end

  # The headers a proxied request goes to the shop with.
  def proxy_headers(browser)
    headers = { "x-droplet-location" => ORIGIN }
    FORWARDED_REQUEST_HEADERS.each do |name|
      value = browser.headers[name]
      headers[name] = value if value.present?
    end
    cookie = cookie_header(browser)
    headers["cookie"] = cookie if cookie
    headers
  end

  # GET /droplets/<id>?<params> -> { html:, status:, location:, cookies:, link: }.
  # Only an HTML answer is a fragment (a 500 or 504 carries the droplet's
  # error page); anything else may echo the props, so it is never inserted.
  def fragment(id, params, cookie:, referer:)
    # The browser's request, as the shop should see it: its shop cookies, this page as the host.
    headers = { "accept" => "text/html", "x-droplet-location" => ORIGIN, "referer" => referer }
    headers["cookie"] = cookie if cookie
    target = "/droplets/#{ERB::Util.url_encode(id)}?#{URI.encode_www_form(params)}"
    result = { html: "", status: 502, location: nil, cookies: [], link: nil }
    begin
      response = request("GET", target, headers)
      code = response.code.to_i
      result.merge!(status: code, cookies: response.get_fields("set-cookie") || [], link: response["link"])
      if (300..399).cover?(code)
        result[:location] = response["location"]
      elsif (response.is_a?(Net::HTTPSuccess) || [500, 504].include?(code)) && response["content-type"].to_s.start_with?("text/html")
        # Trusted markup from the shop: inserted as it is.
        result[:html] = response.body.to_s.force_encoding("UTF-8").html_safe
        return result
      end
    rescue StandardError => e
      Rails.logger.warn("[shop] #{id}: #{e.message}")
    end
    reason = result[:status] == 502 ? "unreachable" : "HTTP #{result[:status]}"
    result[:html] = helpers.tag.p("The #{id} droplet is unavailable (#{reason}).", class: "shop-unavailable")
    result
  end

  # A product's name, category and id, from the product page's public `_data` read.
  def product(slug)
    target = "/droplets/product-page/_data?#{URI.encode_www_form(slug: slug)}"
    response = request("GET", target, { "x-droplet-location" => ORIGIN, "accept" => "application/json" })
    return nil unless response.is_a?(Net::HTTPSuccess)

    found = JSON.parse(response.body.to_s).dig("data", "product")
    found if found.is_a?(Hash) && found["id"].is_a?(String) && found["name"].is_a?(String)
  rescue StandardError
    nil
  end

  # The fragments' `Link` preloads, as tags for the page's head: on the shop's origin only.
  def link_tags(results)
    tags = results.flat_map do |result|
      result[:link].to_s.split(/,(?=\s*<)/).filter_map do |part|
        match = /\A\s*<([^>]*)>(.*)\z/m.match(part)
        next unless match

        params = match[2].split(";").each_with_object({}) do |param, found|
          key, value = param.split("=", 2).map { |piece| piece.to_s.strip.delete_prefix('"').delete_suffix('"') }
          found[key] = value if key.present? && value.present?
        end
        next unless %w[preload modulepreload].include?(params["rel"])

        href = URI(match[1]) rescue next
        next unless "#{href.scheme}://#{href.host}#{":#{href.port}" unless href.port == href.default_port}" == ORIGIN

        helpers.tag.link(rel: params["rel"], href: match[1], as: params["as"])
      end
    end
    helpers.safe_join(tags.uniq, "\n")
  end
end
