Rails.application.routes.draw do
  # The basic page: the Svelte example's three droplets.
  root "home#index"

  # The shop demo's pages.
  scope format: false do
    get "gallery", to: "shop#gallery"
    get "product/:slug", to: "shop#product"
    get "login", to: "shop#login"
    get "admin", to: "shop#admin"
  end

  # What the browser asks the shop for, passed on under this origin, every verb.
  %w[index.js env.js index.css droplets/*path assets/*path api/*path].each do |path|
    match path, to: ShopProxy, via: :all, format: false
  end
end
