using System.Text.Encodings.Web;
using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DropletsHost.Pages;

/// <summary>
/// The Svelte example's three droplets, one per mode, fetched as HTML
/// fragments with <c>x-droplet-location</c> set to the origin browsers use.
/// The page loads <c>/index.js</c> once; the elements then hydrate themselves.
/// </summary>
public sealed class IndexModel(IHttpClientFactory clients, HostSettings settings, ILogger<IndexModel> logger) : PageModel
{
    private static readonly string[] Ids = ["client", "ssr-hydrate", "ssr-nohydrate"];

    public string DropletsPublicUrl => settings.DropletsPublicUrl;
    public IReadOnlyList<string> Fragments { get; private set; } = [];

    public async Task OnGet(string who = "ASP.NET Core")
    {
        Fragments = await Task.WhenAll(Ids.Select(id => Fetch(id, [new Pair("who", who)])));
    }

    private async Task<string> Fetch(string droplet, IReadOnlyList<Pair> props)
    {
        var url = $"{settings.DropletsInternalUrl}/droplets/{Uri.EscapeDataString(droplet)}?{ShopRequest.BuildQuery(props)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("accept", "text/html");
        request.Headers.TryAddWithoutValidation("x-droplet-location", settings.DropletsPublicUrl);
        try
        {
            using var response = await clients.CreateClient(HostApp.DropletsClient).SendAsync(request, HttpContext.RequestAborted);
            // Only an HTML answer is a fragment (a 500 carries the droplet's error
            // page); anything else may echo the props, so it is never pasted.
            var isHtml = response.Content.Headers.ContentType?.MediaType == "text/html";
            if ((response.IsSuccessStatusCode || (int)response.StatusCode == 500) && isHtml)
            {
                return await response.Content.ReadAsStringAsync(HttpContext.RequestAborted);
            }
            return $"<p class=\"error\">droplet \"{HtmlEncoder.Default.Encode(droplet)}\" unavailable: HTTP {(int)response.StatusCode}</p>";
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            // The error names the internal URL: it goes to the log, not the page.
            logger.LogError(error, "{Droplet}: the droplets server is unreachable", droplet);
            return $"<p class=\"error\">droplet \"{HtmlEncoder.Default.Encode(droplet)}\" unavailable</p>";
        }
    }
}
