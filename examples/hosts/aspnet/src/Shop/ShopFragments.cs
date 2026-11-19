using System.Text.Encodings.Web;
using System.Text.Json;

namespace DropletsHost.Shop;

/// <summary>A droplet the page asks for, with its props.</summary>
public sealed record Wanted(string Droplet, IReadOnlyList<Pair> Props);

/// <summary>A fragment's answer: the HTML to insert, or the redirect and cookies to pass on.</summary>
public sealed record Fragment(string Html, int Status, string? Location, IReadOnlyList<string> Cookies, string? Link);

/// <summary>A product as the product page's <c>_data</c> has it.</summary>
public sealed record Product(string Id, string Name, string Slug, string CategorySlug, string CategoryName);

/// <summary>The shop's fragments, fetched on the server as the browser's request: its cookies, this page as the host.</summary>
public sealed class ShopFragments(IHttpClientFactory clients, HostSettings settings, ILogger<ShopFragments> logger)
{
    /// <summary>Every one of <paramref name="wanted"/>, all at once, in that order.</summary>
    public Task<Fragment[]> GetAll(HttpContext context, IEnumerable<Wanted> wanted) =>
        Task.WhenAll(wanted.Select(one => Get(context, one)));

    /// <summary>
    /// <c>GET /droplets/&lt;id&gt;?&lt;props&gt;</c>. Only an HTML answer is a
    /// fragment (a 500 carries the droplet's error page); anything else may
    /// echo the props, so it is never inserted.
    /// </summary>
    public async Task<Fragment> Get(HttpContext context, Wanted wanted)
    {
        var url = $"{settings.ShopInternalUrl}/droplets/{Uri.EscapeDataString(wanted.Droplet)}?{ShopRequest.BuildQuery(wanted.Props)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("accept", "text/html");
        request.Headers.TryAddWithoutValidation("x-droplet-location", settings.ShopOrigin);
        request.Headers.TryAddWithoutValidation("referer", settings.ShopOrigin + ShopRequest.RawTarget(context));
        var cookie = ShopRequest.ShopCookie(context.Request.Headers.Cookie);
        if (cookie is not null) request.Headers.TryAddWithoutValidation("cookie", cookie);

        var status = StatusCodes.Status502BadGateway;
        string? location = null;
        IReadOnlyList<string> cookies = [];
        string? link = null;
        try
        {
            using var response = await clients.CreateClient(HostApp.ShopClient).SendAsync(request, context.RequestAborted);
            status = (int)response.StatusCode;
            cookies = response.Headers.TryGetValues("set-cookie", out var setCookies) ? setCookies.ToArray() : [];
            link = response.Headers.TryGetValues("link", out var links) ? string.Join(", ", links) : null;
            var isHtml = response.Content.Headers.ContentType?.MediaType == "text/html";
            if (status is >= 300 and < 400)
            {
                location = response.Headers.Location?.OriginalString;
            }
            else if ((response.IsSuccessStatusCode || status == 500) && isHtml)
            {
                // Trusted markup from the shop: inserted as it is.
                return new Fragment(await response.Content.ReadAsStringAsync(context.RequestAborted), status, null, cookies, link);
            }
        }
        catch (Exception error) when ((error is HttpRequestException or TaskCanceledException) && !context.RequestAborted.IsCancellationRequested)
        {
            // The error names the internal URL: it goes to the log, not the page.
            logger.LogError(error, "{Droplet}: the shop is unreachable", wanted.Droplet);
        }
        var reason = status == StatusCodes.Status502BadGateway ? "unreachable" : $"HTTP {status}";
        var html = $"<p class=\"shop-unavailable\">The {HtmlEncoder.Default.Encode(wanted.Droplet)} droplet is unavailable ({reason}).</p>";
        return new Fragment(html, status, location, cookies, link);
    }

    /// <summary>A product's id, name and category, from the product page's public <c>_data</c> read, or null.</summary>
    public async Task<Product?> Product(string slug, CancellationToken cancel)
    {
        var url = $"{settings.ShopInternalUrl}/droplets/product-page/_data?{ShopRequest.BuildQuery([new Pair("slug", slug)])}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("accept", "application/json");
        request.Headers.TryAddWithoutValidation("x-droplet-location", settings.ShopOrigin);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            using var response = await clients.CreateClient(HostApp.ShopClient).SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode) return null;
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
            if (!Member(json.RootElement, "data", out var data) || !Member(data, "product", out var product)) return null;
            if (Text(product, "id") is not { } id || Text(product, "name") is not { } name) return null;
            Member(product, "category", out var category);
            return new Product(id, name, Text(product, "slug") ?? slug, Text(category, "slug") ?? "", Text(category, "name") ?? "");
        }
        catch (Exception error) when ((error is HttpRequestException or TaskCanceledException or JsonException) && !cancel.IsCancellationRequested)
        {
            logger.LogError(error, "product {Slug}: no answer from the shop", slug);
            return null;
        }
    }

    private static bool Member(JsonElement element, string name, out JsonElement value)
    {
        value = default;
        return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value) && value.ValueKind == JsonValueKind.Object;
    }

    private static string? Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
