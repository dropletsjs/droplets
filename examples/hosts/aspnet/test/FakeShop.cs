using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DropletsHost.Tests;

/// <summary>A request as the shop saw it.</summary>
public sealed record Seen(string Method, string Target, IReadOnlyDictionary<string, string> Headers, byte[]? Body);

/// <summary>Stands in for the shop behind the host's <see cref="HttpClient"/>, answering with <c>answer</c>.</summary>
public sealed class FakeShop(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
{
    public ConcurrentQueue<Seen> Requests { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
    {
        var headers = request.Headers.Concat(request.Content?.Headers ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>())
            .ToDictionary(header => header.Key.ToLowerInvariant(), header => string.Join(", ", header.Value));
        var body = request.Content is null ? null : await request.Content.ReadAsByteArrayAsync(cancel);
        Requests.Enqueue(new Seen(request.Method.Method, request.RequestUri!.PathAndQuery, headers, body));
        return answer(request);
    }

    public static HttpResponseMessage Html(string html) =>
        new(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") };
}

/// <summary>The host on Kestrel, on a free loopback port, in front of a <see cref="FakeShop"/>.</summary>
public sealed class RunningHost : IAsyncDisposable
{
    public const string PublicOrigin = "https://shop.example";

    private readonly WebApplication app;

    private RunningHost(WebApplication app) => this.app = app;

    public Uri Address => new(app.Urls.First());

    public static async Task<RunningHost> Start(FakeShop shop)
    {
        var app = HostApp.Build([], builder =>
        {
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SHOP_INTERNAL_URL"] = "http://shop.internal:8300",
                ["SHOP_PUBLIC_URL"] = PublicOrigin + "/ignored/path",
            });
            builder.Services.AddHttpClient(HostApp.ShopClient).ConfigurePrimaryHttpMessageHandler(() => shop);
        });
        await app.StartAsync();
        return new RunningHost(app);
    }

    public HttpClient Client() => new(new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false }) { BaseAddress = Address };

    /// <summary>
    /// Sends <paramref name="head"/> as it is, on a socket: <see cref="HttpClient"/>
    /// would resolve the dot segments the tests send. Returns the status code.
    /// </summary>
    public async Task<int> Raw(string head)
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(Address.Host, Address.Port);
        var stream = tcp.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head.ReplaceLineEndings("\r\n") + "\r\n\r\n"));
        using var reader = new StreamReader(stream, Encoding.ASCII);
        var status = await reader.ReadLineAsync() ?? "";
        return int.Parse(status.Split(' ')[1]);
    }

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }
}
