namespace DropletsHost.Shop;

/// <summary>
/// A same-origin proxy for what the browser asks the shop for, so its
/// cookies (the cart, the admin session) are first-party and nothing is
/// cross-origin.
/// </summary>
public static class ShopProxy
{
    /// <summary>The largest body passed on; the shop caps its own at 3 MB.</summary>
    public const long MaxBody = 4 * 1024 * 1024;

    private static readonly string[] Methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

    private static readonly string[] Routes = ["/index.js", "/env.js", "/index.css", "/droplets/{**rest}", "/assets/{**rest}", "/api/{**rest}"];

    /// <summary>What the browser's request may tell the shop; nothing that names a host. <c>cookie</c> goes on filtered.</summary>
    public static readonly string[] ForwardedRequestHeaders =
    [
        "accept",
        "accept-language",
        "content-type",
        "if-none-match",
        "origin",
        "referer",
        "user-agent",
        "x-droplet-props",
        "x-droplets-build",
    ];

    /// <summary>Per hop, or no longer true once Kestrel frames the body again.</summary>
    private static readonly HashSet<string> DroppedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "connection",
        "content-length",
        "keep-alive",
        "proxy-authenticate",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    };

    public static void MapShopProxy(this IEndpointRouteBuilder app)
    {
        foreach (var route in Routes) app.MapMethods(route, Methods, Proxy);
    }

    private static async Task Proxy(HttpContext context, IHttpClientFactory clients, HostSettings settings, ILoggerFactory logs)
    {
        var target = ShopRequest.RawTarget(context);
        if (!ShopRequest.IsShopPath(target))
        {
            await Plain(context, StatusCodes.Status400BadRequest, "Bad request.");
            return;
        }

        var method = context.Request.Method;
        // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
        using var request = new HttpRequestMessage(new HttpMethod(method), settings.ShopInternalUrl + target);
        if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method))
        {
            var body = await ReadBody(context.Request);
            if (body is null)
            {
                await Plain(context, StatusCodes.Status413PayloadTooLarge, "The body is too large.");
                return;
            }
            request.Content = new ByteArrayContent(body);
        }

        request.Headers.TryAddWithoutValidation("x-droplet-location", settings.ShopOrigin);
        foreach (var name in ForwardedRequestHeaders)
        {
            var value = context.Request.Headers[name].ToString();
            if (value.Length == 0) continue;
            if (name == "content-type") request.Content?.Headers.TryAddWithoutValidation(name, value);
            else request.Headers.TryAddWithoutValidation(name, value);
        }
        var cookie = ShopRequest.ShopCookie(context.Request.Headers.Cookie);
        if (cookie is not null) request.Headers.TryAddWithoutValidation("cookie", cookie);

        HttpResponseMessage upstream;
        try
        {
            upstream = await clients.CreateClient(HostApp.ShopClient)
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
        }
        catch (Exception error) when ((error is HttpRequestException or TaskCanceledException) && !context.RequestAborted.IsCancellationRequested)
        {
            logs.CreateLogger("ShopProxy").LogError(error, "{Method} {Path}: the shop is unreachable", method, context.Request.Path);
            await Plain(context, StatusCodes.Status502BadGateway, "The shop is unreachable.");
            return;
        }

        using (upstream)
        {
            context.Response.StatusCode = (int)upstream.StatusCode;
            // `Set-Cookie` and `Location` too, untouched: the shop never sets Domain, so its cookies belong to this origin.
            foreach (var (name, values) in upstream.Headers.Concat(upstream.Content.Headers))
            {
                if (!DroppedResponseHeaders.Contains(name)) context.Response.Headers.Append(name, values.ToArray());
            }
            if (!HttpMethods.IsHead(method))
            {
                await upstream.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
            }
        }
    }

    /// <summary>The request body, or null when it is larger than <see cref="MaxBody"/>.</summary>
    private static async Task<byte[]?> ReadBody(HttpRequest request)
    {
        if (request.ContentLength > MaxBody) return null;
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, request.HttpContext.RequestAborted)) > 0)
        {
            if (buffer.Length + read > MaxBody) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private static Task Plain(HttpContext context, int status, string message)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "text/plain; charset=utf-8";
        return context.Response.WriteAsync(message);
    }
}
