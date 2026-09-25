import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("explains an expired link without rendering provider markup", () => {
    const html = OauthCallbackPage.expired({ provider: `<Hangar> & "Bugit"` })

    expect(html).toContain('data-status="expired"')
    expect(html).toContain("This sign-in link has expired")
    expect(html).toContain("start a new sign-in attempt")
    expect(html).toContain("&lt;Hangar&gt; &amp; &quot;Bugit&quot;")
    expect(html).not.toContain(`<Hangar> & "Bugit"`)
    expect(html).not.toContain("window.close")
  })

  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })
})
