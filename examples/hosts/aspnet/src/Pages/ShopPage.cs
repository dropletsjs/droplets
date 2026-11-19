using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DropletsHost.Pages;

/// <summary>
/// A shop page: the toasts (first in the body), the header's cart and the
/// page's own fragments, fetched all at once and laid out by <c>_ShopLayout</c>.
/// </summary>
public abstract class ShopPage(ShopFragments shop) : PageModel
{
    /// <summary>The stack this host is, in the footer: the one thing that differs between hosts.</summary>
    public const string Stack = "ASP.NET Core";

    public string Title { get; private set; } = "";
    public string? Current { get; private set; }
    public IReadOnlyList<LinkTag> Links { get; private set; } = [];
    public string Toasts { get; private set; } = "";
    public string Cart { get; private set; } = "";
    public IReadOnlyList<string> Fragments { get; private set; } = [];

    protected ShopFragments Shop => shop;

    /// <summary>The page's query as pairs, in order, repeated keys kept.</summary>
    protected List<Pair> PageQuery => ShopRequest.Query(Request.QueryString.Value);

    /// <summary>
    /// Answers a droplet's redirect as it is, otherwise the page; either way
    /// <c>private, no-store</c> (the fragments were rendered with the
    /// visitor's cookies) and with every <c>Set-Cookie</c> the fragments sent.
    /// </summary>
    protected async Task<IActionResult> Render(string title, string? current, IReadOnlyList<Wanted> wanted, int status = StatusCodes.Status200OK)
    {
        var results = await shop.GetAll(
            HttpContext,
            [new Wanted("toast-center", []), new Wanted("shopping-cart", [new Pair("variant", "badge")]), .. wanted]);
        Response.Headers.CacheControl = "private, no-store";
        foreach (var cookie in results.SelectMany(result => result.Cookies)) Response.Headers.Append("set-cookie", cookie);

        var redirect = results.FirstOrDefault(result => result.Location is not null);
        if (redirect is not null)
        {
            Response.Headers.Location = redirect.Location;
            return StatusCode(redirect.Status);
        }

        Title = title;
        Current = current;
        Links = ShopRequest.LinkTags(results.Select(result => result.Link), HttpContext.RequestServices.GetRequiredService<HostSettings>().ShopOrigin);
        Toasts = results[0].Html;
        Cart = results[1].Html;
        Fragments = results.Skip(2).Select(result => result.Html).ToArray();
        Response.StatusCode = status;
        return Page();
    }
}
