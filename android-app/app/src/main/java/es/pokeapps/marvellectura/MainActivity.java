package es.pokeapps.marvellectura;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.CookieManager;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_HOST = "marvel-orden-lectura.pokeapps.workers.dev";
    private static final String LOCAL_ROOT = "www/";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MarvelOrdenLecturaAPK/1.5");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        installServiceWorkerInterceptor();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.APP_URL);
        }
    }

    private void installServiceWorkerInterceptor() {
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return localResponseFor(request.getUrl());
            }
        });
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse local = localResponseFor(request.getUrl());
            return local != null ? local : super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl());
        }
    }

    private final class AppWebChromeClient extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                    handleNavigation(request.getUrl());
                    popupView.destroy();
                    return true;
                }
            });

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    /**
     * Sirve la PWA empaquetada desde assets manteniendo el origen HTTPS real.
     * /api/* se deja deliberadamente al Worker: son mejoras online, mientras que
     * biblioteca, búsqueda, Sagas y la caché Marvel funcionan sin conexión.
     */
    private WebResourceResponse localResponseFor(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            return null;
        }
        String host = uri.getHost();
        if (host == null || !APP_HOST.equalsIgnoreCase(host)) {
            return null;
        }

        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "index.html";
        } else {
            while (path.startsWith("/")) {
                path = path.substring(1);
            }
        }

        if (path.startsWith("api/") || path.contains("..") || path.indexOf('\\') >= 0) {
            return null;
        }
        if (path.endsWith("/")) {
            path += "index.html";
        }

        try {
            InputStream input = getAssets().open(LOCAL_ROOT + path);
            return new WebResourceResponse(mimeTypeFor(path), encodingFor(path), input);
        } catch (IOException missingLocalAsset) {
            return null;
        }
    }

    private String mimeTypeFor(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private String encodingFor(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".js") ||
                lower.endsWith(".mjs") || lower.endsWith(".css") || lower.endsWith(".json") ||
                lower.endsWith(".webmanifest") || lower.endsWith(".svg") || lower.endsWith(".txt")) {
            return "UTF-8";
        }
        return null;
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) {
            return false;
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }

        if ("intent".equalsIgnoreCase(scheme)) {
            handleIntentUri(uri.toString());
            return true;
        }

        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
            String host = uri.getHost();
            if (host != null && APP_HOST.equalsIgnoreCase(host)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        openExternal(uri);
        return true;
    }

    private void handleIntentUri(String rawUrl) {
        try {
            Intent intent = Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME);
            try {
                startActivity(intent);
                return;
            } catch (ActivityNotFoundException ignored) {
                String fallbackUrl = intent.getStringExtra("browser_fallback_url");
                if (fallbackUrl != null && !fallbackUrl.trim().isEmpty()) {
                    openExternal(Uri.parse(fallbackUrl));
                    return;
                }

                String packageName = intent.getPackage();
                if (packageName != null && !packageName.trim().isEmpty()) {
                    if (!openExternal(Uri.parse("market://details?id=" + packageName))) {
                        openExternal(Uri.parse("https://play.google.com/store/apps/details?id=" + packageName));
                    }
                }
            }
        } catch (Exception ignored) {
            // Un intent mal formado no debe bloquear la navegación de la app.
        }
    }

    private boolean openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
