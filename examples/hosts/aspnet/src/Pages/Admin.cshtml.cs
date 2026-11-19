using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc;

namespace DropletsHost.Pages;

public sealed class AdminModel(ShopFragments shop) : ShopPage(shop)
{
    public Task<IActionResult> OnGet() =>
        Render("Admin", "/admin", [new Wanted("product-admin", ShopRequest.Pick(PageQuery, "view", "id"))]);
}
