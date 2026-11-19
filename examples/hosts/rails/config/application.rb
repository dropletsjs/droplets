require_relative "boot"

require "rails"
require "action_controller/railtie"
require "action_view/railtie"

Bundler.require(*Rails.groups)

module DropletsHost
  class Application < Rails::Application
    config.load_defaults 8.1
    config.eager_load = !Rails.env.test?
    config.logger = ActiveSupport::TaggedLogging.logger($stdout)
    config.log_level = :info
    config.public_file_server.enabled = true

    # Nothing here is signed or encrypted (no session, no cookie of this
    # app's own), but Rails asks for a key at boot.
    config.secret_key_base = ENV["SECRET_KEY_BASE"].presence || SecureRandom.hex(64)
    config.session_store :disabled

    # The proxy reads the body itself, once routed: Rack::MethodOverride would
    # parse a form body before any route is chosen.
    config.middleware.delete Rack::MethodOverride
    # The shop's answers keep their own caching headers.
    config.middleware.delete Rack::ETag
    config.middleware.delete Rack::ConditionalGet
  end
end
