using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc;

namespace DropletsHost.Pages;

public sealed class GalleryModel(ShopFragments shop) : ShopPage(shop)
{
    // The whole query to both: the shop drops what a droplet does not take.
    public Task<IActionResult> OnGet() =>
        Render("Gallery", "/gallery", [new Wanted("product-filter", PageQuery), new Wanted("product-library", PageQuery)]);
}
