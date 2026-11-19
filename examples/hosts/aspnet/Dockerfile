FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /host
COPY src/DropletsHost.csproj src/packages.lock.json src/
COPY test/DropletsHost.Tests.csproj test/packages.lock.json test/
RUN dotnet restore test/DropletsHost.Tests.csproj --locked-mode
COPY . .
# The host's own logic (the proxy's allow-lists and limits, what a page inserts) is checked on every build.
RUN dotnet test test/DropletsHost.Tests.csproj --no-restore -c Release
RUN dotnet publish src/DropletsHost.csproj --no-restore -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8014
EXPOSE 8014
USER $APP_UID
ENTRYPOINT ["dotnet", "DropletsHost.dll"]
