import { NextResponse } from "next/server";

import { siteOrigin } from "@/lib/site-url";

/**
 * Lightweight embed bootstrap for third-party sites (WordPress, Squarespace, etc.).
 * Plain ES5, IIFE, one namespaced global: window.SwiftToursEmbed
 */
export function GET() {
  const origin = siteOrigin();

  const script = `(function (global) {
  "use strict";
  var NS = (global.SwiftToursEmbed = global.SwiftToursEmbed || {});
  var ATTR = "data-swift-tour";
  var INIT = "data-swift-initialized";
  var FALLBACK_ORIGIN = ${JSON.stringify(origin)};

  function scriptOrigin() {
    var scripts = document.getElementsByTagName("script");
    var i;
    for (i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("/embed.js") !== -1) {
        return src.replace(/\\/embed\\.js(?:\\?.*)?$/, "");
      }
    }
    return FALLBACK_ORIGIN;
  }

  function createResponsiveFrame(src) {
    var wrap = document.createElement("div");
    wrap.setAttribute(
      "style",
      "position:relative;width:100%;height:0;padding-top:56.25%;overflow:hidden;"
    );
    var iframe = document.createElement("iframe");
    iframe.setAttribute("src", src);
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute(
      "allow",
      "fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; autoplay; encrypted-media; picture-in-picture"
    );
    iframe.setAttribute(
      "style",
      "position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
    );
    wrap.appendChild(iframe);
    return { wrap: wrap, iframe: iframe };
  }

  function initOne(el, host) {
    if (el.getAttribute(INIT)) return;
    var slug = el.getAttribute(ATTR);
    if (!slug) return;
    var params = el.getAttribute("data-params") || "";
    var src =
      host +
      "/embed/" +
      encodeURIComponent(slug) +
      (params ? "?" + params : "");
    var built = createResponsiveFrame(src);
    el.setAttribute(INIT, "1");
    el.appendChild(built.wrap);
  }

  function initAll() {
    var host = scriptOrigin();
    var nodes = document.querySelectorAll("[" + ATTR + "]:not([" + INIT + "])");
    var i;
    for (i = 0; i < nodes.length; i++) {
      initOne(nodes[i], host);
    }
  }

  function onMessage(event) {
    var data = event && event.data;
    if (!data || data.source !== "swift-tours") return;
    if (data.type !== "ready" || typeof data.height !== "number") return;
    var iframes = document.getElementsByTagName("iframe");
    var i;
    for (i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow !== event.source) continue;
      var wrap = iframes[i].parentNode;
      if (!wrap || !wrap.style) break;
      // Snap from the 16:9 placeholder to the reported viewer height.
      wrap.style.paddingTop = "0";
      wrap.style.height = Math.max(240, Math.round(data.height)) + "px";
      break;
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", onMessage);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  NS.init = initAll;
})(typeof window !== "undefined" ? window : this);
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control":
        "public, max-age=86400, stale-while-revalidate=604800",
      // Embed script is loaded cross-origin; allow any site to fetch it.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
