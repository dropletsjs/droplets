export const prerender = true;

export default ({ data }) => `<article data-testid="docs"><h1>${data.title}</h1><p>@HOST@</p><a href="${data.home}">home</a></article>`;
