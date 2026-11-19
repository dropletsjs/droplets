using System.Net;
using System.Text;

namespace DropletsHost.Tests;

public sealed class PageTests
{
    [Fact]
    public async Task InsertsTheFragmentsWithTheirCookiesAndThePageAsReferer()
    {
        var shop = new FakeShop(request =>
        {
            var id = request.RequestUri!.AbsolutePath.Split('/')[2];
            var answer = FakeShop.Html($"<djs-shop data-droplet=\"{id}\"></djs-shop>");
            if (id == "shopping-cart") answer.Headers.Add("set-cookie", "cart_id=new; HttpOnly");
            return answer;
        });
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();

        using var response = await client.GetAsync("/gallery?q=mug&q=cup&category=", TestContext.Current.CancellationToken);
        var html = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("private, no-store", response.Headers.NonValidated["cache-control"].ToString());
        Assert.Equal(new[] { "cart_id=new; HttpOnly" }, response.Headers.GetValues("set-cookie"));
        Assert.True(html.IndexOf("data-droplet=\"toast-center\"") < html.IndexOf("<header"), "the toasts come first");
        Assert.Contains("<djs-shop data-droplet=\"product-library\"></djs-shop>", html);
        var library = Assert.Single(shop.Requests, seen => seen.Target.StartsWith("/droplets/product-library"));
        Assert.Equal("/droplets/product-library?q=mug&q=cup&category=", library.Target);
        Assert.Equal(RunningHost.PublicOrigin + "/gallery?q=mug&q=cup&category=", library.Headers["referer"]);
        Assert.Equal(RunningHost.PublicOrigin, library.Headers["x-droplet-location"]);
    }

    [Fact]
    public async Task NeverInsertsAnAnswerThatIsNotHtml()
    {
        var shop = new FakeShop(request => request.RequestUri!.AbsolutePath == "/droplets/login"
            ? new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent("{\"error\":\"<script>alert(1)</script>\"}", Encoding.UTF8, "application/json"),
            }
            : FakeShop.Html("<p>ok</p>"));
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();

        var html = await client.GetStringAsync("/login?next=%3Cscript%3E", TestContext.Current.CancellationToken);

        Assert.DoesNotContain("<script>alert(1)</script>", html);
        Assert.Contains("<p class=\"shop-unavailable\">The login droplet is unavailable (HTTP 400).</p>", html);
    }

    [Fact]
    public async Task AnswersAFragmentsRedirectAsItIs()
    {
        var shop = new FakeShop(request =>
        {
            if (request.RequestUri!.AbsolutePath != "/droplets/product-admin") return FakeShop.Html("<p>ok</p>");
            var answer = new HttpResponseMessage(HttpStatusCode.Found);
            answer.Headers.Location = new Uri(RunningHost.PublicOrigin + "/login?next=%2Fadmin");
            return answer;
        });
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();

        using var response = await client.GetAsync("/admin", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Found, response.StatusCode);
        Assert.Equal(RunningHost.PublicOrigin + "/login?next=%2Fadmin", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public async Task AnswersAnUnknownProductWith404()
    {
        var shop = new FakeShop(request => request.RequestUri!.AbsolutePath.EndsWith("/_data")
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"data\":{\"product\":null}}", Encoding.UTF8, "application/json") }
            : FakeShop.Html("<p>ok</p>"));
        await using var host = await RunningHost.Start(shop);
        using var client = host.Client();

        using var response = await client.GetAsync("/product/nothing-here", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("This product does not exist.", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }
}
