using DropletsHost.Shop;
using Microsoft.AspNetCore.Mvc;

namespace DropletsHost.Pages;

public sealed class LoginModel(ShopFragments shop) : ShopPage(shop)
{
    public Task<IActionResult> OnGet() => Render("Log in", null, [new Wanted("login", ShopRequest.Pick(PageQuery, "next"))]);
}
