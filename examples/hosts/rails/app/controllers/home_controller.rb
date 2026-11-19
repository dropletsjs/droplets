# Droplets embedded from Rails.
#
# The action fetches each droplet as an HTML fragment from the droplets
# server, with `x-droplet-location` set to the origin browsers will use, and
# the ERB view prints the fragments into the page. The view loads `/index.js`
# once.

require "net/http"
require "uri"

class HomeController < ActionController::Base
  # Server-to-server address (inside Docker: the service name).
  DROPLETS_INTERNAL_URL = ENV.fetch("DROPLETS_INTERNAL_URL", "http://localhost:8000")
  # Browser-facing address, written onto every fragment.
  DROPLETS_PUBLIC_URL = ENV.fetch("DROPLETS_PUBLIC_URL", "http://localhost:8000")

  # The Svelte example's droplets (examples/frameworks/svelte), one per mode.
  IDS = %w[client ssr-hydrate ssr-nohydrate].freeze

  layout false

  def index
    who = params.permit(:who).fetch(:who, "Rails")
    @droplets_public_url = DROPLETS_PUBLIC_URL
    @fragments = IDS.map { |id| fetch_droplet(id, who: who) }
  end

  private

  # GET /droplets/<id>?props -> the droplet element's fragment, or an inline error.
  def fetch_droplet(droplet, props = {})
    uri = URI("#{DROPLETS_INTERNAL_URL}/droplets/#{droplet}")
    uri.query = URI.encode_www_form(props) unless props.empty?

    # Net::HTTP never follows a redirect.
    answer = Net::HTTP.start(uri.host, uri.port, open_timeout: 5, read_timeout: 5) do |http|
      http.get(uri.request_uri, { "accept" => "text/html", "x-droplet-location" => DROPLETS_PUBLIC_URL })
    end
    # Only an HTML answer is a fragment (a 500 carries the droplet's error
    # page); anything else may echo the props, so it is never printed.
    is_html = answer["content-type"].to_s.start_with?("text/html")
    return answer.body.to_s.force_encoding("UTF-8").html_safe if (answer.is_a?(Net::HTTPSuccess) || answer.code == "500") && is_html

    helpers.tag.p(%(droplet "#{droplet}" unavailable: HTTP #{answer.code}), class: "error")
  rescue StandardError => e
    helpers.tag.p(%(droplet "#{droplet}" unavailable: #{e.message}), class: "error")
  end
end
