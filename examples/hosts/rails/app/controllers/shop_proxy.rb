# What the browser asks the shop for (`/index.js`, `/env.js`, `/index.css`,
# `/droplets/*`, `/assets/*`, `/api/*`), passed on under this origin, so the
# shop's cookies are first-party and nothing is cross-origin.
#
# A Rack endpoint, routed like a controller action: ActionController would
# parse the body into `params` and check a CSRF token before the action ran,
# and rewrite the answer's Cache-Control. The shop checks a post's `Origin`
# itself; the body and the answer go through as they came.
class ShopProxy
  def self.call(env)
    browser = ActionDispatch::Request.new(env)
    # A `.` or `..` segment, once decoded, is never a shop route.
    if browser.path.split("/").any? { |segment| %w[. ..].include?(Rack::Utils.unescape_path(segment)) }
      return text(400, "Bad request.")
    end

    body = nil
    unless browser.get? || browser.head?
      # The header as sent: Rails' own `content_length` reads a chunked body whole to count it.
      return text(413, "The body is too large.") if browser.get_header("CONTENT_LENGTH").to_i > Shop::MAX_BODY

      body = browser.body.read(Shop::MAX_BODY + 1).to_s
      return text(413, "The body is too large.") if body.bytesize > Shop::MAX_BODY
    end
    upstream = Shop.request(browser.request_method, browser.original_fullpath, Shop.proxy_headers(browser), body)

    headers = Rack::Headers.new
    upstream.each_header do |name, value|
      headers[name] = value unless Shop::DROPPED_RESPONSE_HEADERS.include?(name)
    end
    # Untouched: the shop never sets Domain, so they belong to this origin.
    cookies = upstream.get_fields("set-cookie")
    headers["set-cookie"] = cookies if cookies
    [upstream.code.to_i, headers, [upstream.body.to_s]]
  rescue StandardError => e
    Rails.logger.warn("[shop proxy] #{env['REQUEST_METHOD']} #{env['PATH_INFO']}: #{e.message}")
    text(502, "The shop is unreachable.")
  end

  def self.text(status, message)
    [status, { "content-type" => "text/plain" }, [message]]
  end
end
