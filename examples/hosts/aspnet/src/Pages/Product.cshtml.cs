using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc;

namespace DropletsHost.Pages;

public sealed class ProductModel(ShopFragments shop) : ShopPage(shop)
{
    public Product? Product { get; private set; }

    public async Task<IActionResult> OnGet(string slug)
    {
        Product = await Shop.Product(slug, HttpContext.RequestAborted);
        if (Product is null) return await Render("Not found", null, [], StatusCodes.Status404NotFound);
        var query = PageQuery;
        List<Pair> comments = [.. ShopRequest.Pick(query, "order", "page", "showing"), new Pair("productId", Product.Id)];
        // `v`, when the link had one: the shop serves its build's page for the
        // current version and redirects an old one to this URL without it.
        List<Pair> page = [new Pair("slug", Product.Slug), .. ShopRequest.Pick(query, "v")];
        return await Render(Product.Name, null, [new Wanted("product-page", page), new Wanted("product-comments", comments)]);
    }
}
