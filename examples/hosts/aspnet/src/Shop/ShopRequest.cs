using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;

namespace DropletsHost.Shop;

/// <summary>A query parameter, in the order the URL has it.</summary>
public readonly record struct Pair(string Key, string Value);

/// <summary>A <c>&lt;link&gt;</c> for the page's head, from a fragment's <c>Link</c> header.</summary>
public sealed record LinkTag(string Rel, string Href, string? As);

/// <summary>What the host reads from the browser's request, and how it writes it on for the shop.</summary>
public static partial class ShopRequest
{
    /// <summary>The shop's own cookies, the only ones it is sent: another app's on this origin stay here.</summary>
    public static readonly string[] ShopCookies = ["cart_id", "shop_admin"];

    /// <summary>The request's path and query exactly as the browser sent them.</summary>
    public static string RawTarget(HttpContext context) =>
        context.Features.Get<IHttpRequestFeature>()?.RawTarget ?? "/";

    /// <summary>The browser's <c>Cookie</c> header with the shop's cookies only, or null.</summary>
    public static string? ShopCookie(IEnumerable<string?> headers)
    {
        var kept = headers
            .SelectMany(header => (header ?? "").Split(';'))
            .Select(pair => pair.Trim())
            .Where(pair => ShopCookies.Contains(pair.Split('=', 2)[0].Trim(), StringComparer.Ordinal))
            .ToArray();
        return kept.Length == 0 ? null : string.Join("; ", kept);
    }

    /// <summary>
    /// Whether <paramref name="target"/> is a path the shop may be asked for:
    /// origin-form (<c>/…</c>), with no <c>.</c> or <c>..</c> segment once decoded.
    /// </summary>
    public static bool IsShopPath(string target)
    {
        if (!target.StartsWith('/')) return false;
        var path = target.Split('?', 2)[0];
        return !path.Split('/').Select(Uri.UnescapeDataString).Any(segment => segment is "." or "..");
    }

    /// <summary>
    /// The query as pairs, repeated keys and their order kept (a dictionary
    /// would merge <c>a=1&amp;a=2</c> and lose the order).
    /// </summary>
    public static List<Pair> Query(string? query)
    {
        var pairs = new List<Pair>();
        foreach (var piece in (query ?? "").TrimStart('?').Split('&'))
        {
            if (piece.Length == 0) continue;
            var parts = piece.Split('=', 2);
            pairs.Add(new Pair(Decode(parts[0]), parts.Length > 1 ? Decode(parts[1]) : ""));
        }
        return pairs;
    }

    private static string Decode(string piece) => Uri.UnescapeDataString(piece.Replace('+', ' '));

    /// <summary>The pairs named in <paramref name="keys"/>, in that order.</summary>
    public static List<Pair> Pick(IReadOnlyList<Pair> query, params string[] keys) =>
        keys.SelectMany(key => query.Where(pair => pair.Key == key)).ToList();

    /// <summary>Pairs → a query string, every piece encoded.</summary>
    public static string BuildQuery(IEnumerable<Pair> pairs) =>
        string.Join('&', pairs.Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

    [GeneratedRegex(@",(?=\s*<)")]
    private static partial Regex LinkSeparator();

    [GeneratedRegex(@"^\s*<([^>]*)>(.*)$", RegexOptions.Singleline)]
    private static partial Regex LinkValue();

    /// <summary>The fragments' <c>Link</c> preloads, for the page's head: on <paramref name="origin"/> only.</summary>
    public static List<LinkTag> LinkTags(IEnumerable<string?> headers, string origin)
    {
        var tags = new List<LinkTag>();
        foreach (var part in headers.SelectMany(header => LinkSeparator().Split(header ?? "")))
        {
            var match = LinkValue().Match(part);
            if (!match.Success) continue;
            var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var parameter in match.Groups[2].Value.Split(';'))
            {
                var pieces = parameter.Split('=', 2);
                var key = pieces[0].Trim();
                var value = pieces.Length > 1 ? pieces[1].Trim().Trim('"') : "";
                if (key.Length > 0 && value.Length > 0) parameters[key] = value;
            }
            var rel = parameters.GetValueOrDefault("rel");
            if (rel is not ("preload" or "modulepreload")) continue;
            var href = match.Groups[1].Value;
            if (!Uri.TryCreate(href, UriKind.Absolute, out var url) || url.GetLeftPart(UriPartial.Authority) != origin) continue;
            var tag = new LinkTag(rel, href, parameters.GetValueOrDefault("as"));
            if (!tags.Contains(tag)) tags.Add(tag);
        }
        return tags;
    }
}
