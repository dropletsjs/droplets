namespace DropletsHost;

/// <summary>
/// Where this host reaches the droplets servers and the origins browsers use,
/// written out in the environment (or any other configuration source): never
/// taken from a request.
/// </summary>
public sealed record HostSettings(string ShopInternalUrl, string ShopOrigin, string DropletsInternalUrl, string DropletsPublicUrl)
{
    public static HostSettings From(IConfiguration configuration) =>
        new(
            // How this process reaches the shop (`http://shop:8300` in Docker).
            ShopInternalUrl: (configuration["SHOP_INTERNAL_URL"] ?? "http://localhost:8300").TrimEnd('/'),
            // This host's own public origin, sent as `x-droplet-location` to the shop.
            ShopOrigin: OriginOf(configuration["SHOP_PUBLIC_URL"] ?? "http://localhost:8014"),
            // The Svelte example, server to server and as browsers reach it.
            DropletsInternalUrl: (configuration["DROPLETS_INTERNAL_URL"] ?? "http://localhost:8000").TrimEnd('/'),
            DropletsPublicUrl: (configuration["DROPLETS_PUBLIC_URL"] ?? "http://localhost:8000").TrimEnd('/'));

    /// <summary>The scheme, host and port of <paramref name="url"/>.</summary>
    public static string OriginOf(string url) => new Uri(url, UriKind.Absolute).GetLeftPart(UriPartial.Authority);
}
