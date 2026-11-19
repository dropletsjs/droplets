using DropletsHost.Shop;

namespace DropletsHost.Tests;

public sealed class ShopRequestTests
{
    [Fact]
    public void KeepsTheQuerysOrderAndRepeatedKeys()
    {
        var query = ShopRequest.Query("?b=2&a=1&a=x+y&c&%5F%5Fproto%5F%5F=1");
        Assert.Equal(new Pair[] { new("b", "2"), new("a", "1"), new("a", "x y"), new("c", ""), new("__proto__", "1") }, query);
        Assert.Equal(new Pair[] { new("a", "1"), new("a", "x y"), new("b", "2") }, ShopRequest.Pick(query, "a", "b"));
        Assert.Equal("a=x%20y&b=%26", ShopRequest.BuildQuery([new Pair("a", "x y"), new Pair("b", "&")]));
    }

    [Fact]
    public void KeepsOnlyPreloadsOnTheShopsOrigin()
    {
        var tags = ShopRequest.LinkTags(
            [
                "<https://shop.example/assets/a.js>; rel=modulepreload, <https://elsewhere.example/b.js>; rel=modulepreload",
                "<https://shop.example/assets/c.css>; rel=\"preload\"; as=style, <https://shop.example/d>; rel=stylesheet",
                "<https://shop.example/assets/a.js>; rel=modulepreload",
            ],
            "https://shop.example");
        Assert.Equal(
            new[] { new LinkTag("modulepreload", "https://shop.example/assets/a.js", null), new LinkTag("preload", "https://shop.example/assets/c.css", "style") },
            tags);
    }

    [Fact]
    public void FindsNoShopCookieInSomeoneElsesCookies()
    {
        Assert.Null(ShopRequest.ShopCookie(["cart_idx=1; xcart_id=2", null]));
        Assert.Equal("cart_id=1", ShopRequest.ShopCookie(["a=b", "cart_id=1"]));
    }
}
