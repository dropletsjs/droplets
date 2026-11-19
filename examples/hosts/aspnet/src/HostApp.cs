using System.Net;
using System.Text.Encodings.Web;
using System.Text.Unicode;
using DropletsHost.Shop;
using Microsoft.Extensions.WebEncoders;

namespace DropletsHost;

/// <summary>The app: the Svelte example's page at <c>/</c>, the shop's pages and the proxy to the shop.</summary>
public static class HostApp
{
    /// <summary>Named <see cref="HttpClient"/>s from <see cref="IHttpClientFactory"/>.</summary>
    public const string ShopClient = "shop";
    public const string DropletsClient = "droplets";

    /// <summary>
    /// The handler behind both clients. One pool serves every visitor, so it
    /// must never keep cookies: a shared container would hand the first
    /// visitor's cart and admin session to the next. Each request carries
    /// the browser's own <c>Cookie</c>; a redirect goes back to the browser.
    /// </summary>
    public static SocketsHttpHandler Handler() =>
        new() { UseCookies = false, AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None };

    /// <param name="configure">Runs last, before the app is built: the tests swap the handler and the settings there.</param>
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        // The application name keeps the Razor Pages discoverable when another assembly (the tests) starts the app.
        var builder = WebApplication.CreateBuilder(
            new WebApplicationOptions { Args = args, ApplicationName = typeof(HostApp).Assembly.GetName().Name });

        builder.Services.AddSingleton(services => HostSettings.From(services.GetRequiredService<IConfiguration>()));
        builder.Services.AddHttpClient(ShopClient, client => client.Timeout = TimeSpan.FromSeconds(10))
            .ConfigurePrimaryHttpMessageHandler(Handler);
        builder.Services.AddHttpClient(DropletsClient, client => client.Timeout = TimeSpan.FromSeconds(10))
            .ConfigurePrimaryHttpMessageHandler(Handler);
        builder.Services.AddScoped<ShopFragments>();
        builder.Services.AddRazorPages();
        // Product names and the page's own text as they are, not as numeric entities.
        builder.Services.Configure<WebEncoderOptions>(options => options.TextEncoderSettings = new TextEncoderSettings(UnicodeRanges.All));

        configure?.Invoke(builder);

        var app = builder.Build();
        app.UseStaticFiles();
        app.MapShopProxy();
        app.MapRazorPages();
        return app;
    }
}
