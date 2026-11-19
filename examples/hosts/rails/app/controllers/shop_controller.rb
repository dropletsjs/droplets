# The shop demo's four pages (`/gallery`, `/product/:slug`, `/login`,
# `/admin`): each fetches the shop's fragments on the server and renders them
# into one layout.
class ShopController < ActionController::Base
  layout "shop"

  def gallery
    # The whole query to both: the shop drops what a droplet does not take.
    query = page_query
    render_shop :gallery, title: "Gallery", current: "/gallery",
                          wanted: [["product-filter", query], ["product-library", query]]
  end

  def product
    @product = Shop.product(request.path_parameters[:slug])
    return render_shop(:not_found, title: "Not found", status: :not_found) unless @product

    @category = @product["category"].is_a?(Hash) ? @product["category"] : {}
    comments = pick(%w[order page showing]) + [["productId", @product["id"]]]
    # `v`, when the link had one: the shop serves its build's page for the
    # current version and redirects an old one to this URL without it.
    page = [["slug", @product["slug"]]] + pick(%w[v])
    render_shop :product, title: @product["name"], wanted: [["product-page", page], ["product-comments", comments]]
  end

  def login
    render_shop :login, title: "Log in", wanted: [["login", pick(%w[next])]]
  end

  def admin
    render_shop :admin, title: "Admin", current: "/admin", wanted: [["product-admin", pick(%w[view id])]]
  end

  private

  # The query as name and value pairs, in order, as the browser sent it.
  def page_query
    URI.decode_www_form(request.query_string)
  rescue ArgumentError
    []
  end

  # The page's query parameters named in `keys`, in that order.
  def pick(keys)
    query = page_query
    keys.flat_map { |key| query.select { |name, _| name == key } }
  end

  # Fetches the toasts (first in the body), the header's cart and the page's
  # fragments (in threads, at once), then answers: a droplet's redirect as it
  # is, otherwise the page, with every `Set-Cookie` the fragments sent.
  def render_shop(view, title:, current: nil, wanted: [], status: :ok)
    cookie = Shop.cookie_header(request)
    referer = Shop::ORIGIN + request.original_fullpath
    requests = [["toast-center", []], ["shopping-cart", [%w[variant badge]]], *wanted]
    threads = requests.map do |id, params|
      Thread.new { Rails.application.executor.wrap { Shop.fragment(id, params, cookie: cookie, referer: referer) } }
    end
    results = threads.map(&:value)
    toasts, cart, *fragments = results

    response.headers["cache-control"] = "private, no-store"
    cookies = results.flat_map { |result| result[:cookies] }
    response.headers["set-cookie"] = cookies unless cookies.empty?
    # Not redirect_to: it would make a path absolute with the request's own Host.
    redirect = results.find { |result| result[:location] }
    if redirect
      response.headers["location"] = redirect[:location]
      return head(redirect[:status])
    end

    @shop = { title: title, current: current, links: Shop.link_tags(results), toasts: toasts[:html], cart: cart[:html] }
    @fragments = fragments.map { |fragment| fragment[:html] }
    render view, status: status
  end
end
