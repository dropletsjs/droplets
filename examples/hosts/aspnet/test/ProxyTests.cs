using DropletsHost.Shop;
using System.Net;
using System.Text;

namespace DropletsHost.Tests;

public sealed class ProxyTests
{
    private static FakeShop Ok() => new(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });

    [Fact]
    public async Task SendsTheConfiguredOriginAsTheLocationNeverTheRequestsHost()
    {
        var shop = Ok();
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/cart");
        request.Headers.Host = "evil.example";
        request.Headers.Add("x-forwarded-host", "evil.example");
        request.Headers.Add("forwarded", "host=evil.example");
        request.Headers.Add("x-droplet-location", "https://evil.example");
        request.Headers.Add("authorization", "Bearer secret");
        request.Headers.Add("x-droplet-props", "{\"who\":\"Ana\"}");

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var seen = Assert.Single(shop.Requests);
        Assert.Equal("/api/cart", seen.Target);
        Assert.Equal(RunningHost.PublicOrigin, seen.Headers["x-droplet-location"]);
        Assert.Equal("{\"who\":\"Ana\"}", seen.Headers["x-droplet-props"]);
        Assert.DoesNotContain("x-forwarded-host", seen.Headers.Keys);
        Assert.DoesNotContain("forwarded", seen.Headers.Keys);
        Assert.DoesNotContain("authorization", seen.Headers.Keys);
        Assert.NotEqual("evil.example", seen.Headers.GetValueOrDefault("host"));
    }

    [Fact]
    public async Task PassesOnTheShopsCookiesOnly()
    {
        var shop = Ok();
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/cart");
        request.Headers.Add("cookie", "other=1; cart_id=abc; session=x; shop_admin=def");

        using var _ = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal("cart_id=abc; shop_admin=def", Assert.Single(shop.Requests).Headers["cookie"]);
    }

    [Theory]
    [InlineData("GET /droplets/../api/cart HTTP/1.1")]
    [InlineData("GET /droplets/%2e%2e/api/cart HTTP/1.1")]
    [InlineData("GET /api/./cart HTTP/1.1")]
    [InlineData("GET http://elsewhere.example/api/cart HTTP/1.1")]
    public async Task RefusesADotSegmentOrATargetThatIsNotAPath(string line)
    {
        var shop = Ok();
        await using var host = await RunningHost.Start(shop);

        var status = await host.Raw($"{line}\nHost: localhost\nConnection: close");

        Assert.Equal(400, status);
        Assert.Empty(shop.Requests);
    }

    [Fact]
    public async Task RefusesABodyOverTheLimitBeforeTheShopSeesIt()
    {
        var shop = Ok();
        await using var host = await RunningHost.Start(shop);

        var status = await host.Raw($"POST /droplets/product-card?/add HTTP/1.1\nHost: localhost\nContent-Length: {ShopProxy.MaxBody + 1}\nConnection: close");

        Assert.Equal(413, status);
        Assert.Empty(shop.Requests);
    }

    [Fact]
    public async Task PassesABodyAndTheAnswersCookiesAndRedirectBack()
    {
        var shop = new FakeShop(_ =>
        {
            var answer = new HttpResponseMessage(HttpStatusCode.SeeOther);
            answer.Headers.Location = new Uri("/admin", UriKind.Relative);
            answer.Headers.Add("set-cookie", ["shop_admin=1; HttpOnly", "cart_id=2; HttpOnly"]);
            return answer;
        });
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();

        using var response = await client.PostAsync(
            "/droplets/login?/login",
            new StringContent("user=admin", Encoding.UTF8, "application/x-www-form-urlencoded"),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.SeeOther, response.StatusCode);
        Assert.Equal("/admin", response.Headers.Location?.OriginalString);
        Assert.Equal(new[] { "shop_admin=1; HttpOnly", "cart_id=2; HttpOnly" }, response.Headers.GetValues("set-cookie"));
        var seen = Assert.Single(shop.Requests);
        Assert.Equal("POST", seen.Method);
        Assert.Equal("user=admin", Encoding.UTF8.GetString(seen.Body!));
        Assert.StartsWith("application/x-www-form-urlencoded", seen.Headers["content-type"]);
    }

    [Fact]
    public void KeepsNoCookiesAndFollowsNoRedirects()
    {
        using var handler = HostApp.Handler();
        Assert.False(handler.UseCookies);
        Assert.False(handler.AllowAutoRedirect);
    }
}
