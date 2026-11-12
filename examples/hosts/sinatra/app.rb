# Droplets embedded from Sinatra.
#
# The route fetches each droplet as an HTML fragment from the droplets server,
# with `x-droplet-location` set to the origin browsers will use, and pastes the
# fragments into an ERB view. The view loads `/index.js` once.

require "sinatra"
require "net/http"
require "uri"

# Server-to-server address (inside Docker: the service name).
DROPLETS_INTERNAL_URL = ENV.fetch("DROPLETS_INTERNAL_URL", "http://localhost:8000")
# Browser-facing address, written onto every fragment.
DROPLETS_PUBLIC_URL = ENV.fetch("DROPLETS_PUBLIC_URL", "http://localhost:8000")

# The Svelte example's droplets (examples/frameworks/svelte), one per mode.
IDS = %w[client ssr-hydrate ssr-nohydrate].freeze

set :bind, "0.0.0.0"
set :port, ENV.fetch("PORT", 8002)

# The shop demo: /gallery, /product/:slug, /login, /admin, and its proxy.
require_relative "shop"

# GET /droplets/<id>?props -> the droplet element's fragment, or an inline error.
def fetch_droplet(droplet, props = {})
  uri = URI("#{DROPLETS_INTERNAL_URL}/droplets/#{droplet}")
  uri.query = URI.encode_www_form(props) unless props.empty?

  # Net::HTTP never follows a redirect.
  response = Net::HTTP.start(uri.host, uri.port, open_timeout: 5, read_timeout: 5) do |http|
    http.get(uri.request_uri, { "accept" => "text/html", "x-droplet-location" => DROPLETS_PUBLIC_URL })
  end
  # Only an HTML answer is a fragment (a 500 carries the droplet's error
  # page); anything else may echo the props, so it is never pasted.
  is_html = response["content-type"].to_s.start_with?("text/html")
  return response.body if (response.is_a?(Net::HTTPSuccess) || response.code == "500") && is_html

  %(<p class="error">droplet "#{Rack::Utils.escape_html(droplet)}" unavailable: HTTP #{response.code}</p>)
rescue StandardError => e
  %(<p class="error">droplet "#{Rack::Utils.escape_html(droplet)}" unavailable: #{Rack::Utils.escape_html(e.message)}</p>)
end

get "/" do
  @droplets_public_url = DROPLETS_PUBLIC_URL
  who = params.fetch("who", "Sinatra")
  @fragments = IDS.map { |id| fetch_droplet(id, who: who) }
  erb :index
end
