package com.halawatuliman.ambulan;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {

    /* Isi assets/public/js/native-bridge.js, dibaca sekali saat halaman pertama dimuat. */
    private String nativeBridgeJs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* WebView memuat situs hosting (server.url di capacitor.config.json), sehingga
           js/native-bridge.js milik halaman web tidak ada di server hosting. Suntikkan
           salinan di dalam APK setelah setiap halaman selesai dimuat agar lokasi latar
           belakang, notifikasi tugas, dan tombol back tetap bekerja. Halaman lokal
           (www) sudah memuat skrip ini sendiri, jadi penyuntikan dilewati. */
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                injectNativeBridge(webView);
            }
        });

        /* Android 16 (targetSdk 36) selalu memakai predictive back, sehingga event
           "backButton" milik plugin App tidak selalu sampai ke JavaScript dan satu
           tekanan back langsung menutup aplikasi. Callback ini mengambil alih tombol
           back lalu menyerahkan keputusan ke native-bridge.js (kembali ke halaman
           sebelumnya / beranda, atau dua kali tekan untuk keluar). */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){try{if(typeof window.__siHandleBack==='function'){" +
                        "window.__siHandleBack();return 'ok';}}catch(e){}return 'none';})()",
                    value -> {
                        // Ditangani JavaScript (kembali ke halaman sebelumnya /
                        // menampilkan petunjuk keluar di beranda).
                        if (value != null && !value.contains("none")) return;
                        handleBackFallback(webView);
                    }
                );
            }
        });
    }

    private void injectNativeBridge(WebView webView) {
        if (webView == null) return;
        String script = loadNativeBridgeJs();
        if (script == null) return;

        String wrapped = "(function(){if(window.__SI_NATIVE_BRIDGE_INJECTED)return;" +
            "window.__SI_NATIVE_BRIDGE_INJECTED=true;try{" + script + "}catch(e){}})();";
        webView.evaluateJavascript(wrapped, null);
    }

    private String loadNativeBridgeJs() {
        if (nativeBridgeJs != null) return nativeBridgeJs;
        try (InputStream in = getAssets().open("public/js/native-bridge.js")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            nativeBridgeJs = out.toString(StandardCharsets.UTF_8.name());
            return nativeBridgeJs;
        } catch (Exception e) {
            return null;
        }
    }

    /* native-bridge.js belum selesai dimuat (mis. back ditekan saat halaman
       masih dibuka) atau gagal dimuat. Jangan langsung menutup aplikasi: ikuti
       riwayat WebView, lalu buka beranda bila tidak ada riwayat. Aplikasi hanya
       boleh tertutup dari beranda. */
    private void handleBackFallback(WebView webView) {
        if (webView == null) {
            finish();
            return;
        }
        try {
            if (webView.canGoBack()) {
                webView.goBack();
                return;
            }
            String url = webView.getUrl();
            boolean atHome = url == null || url.isEmpty()
                || url.endsWith("/") || url.contains("/index.html");
            if (!atHome) {
                // Muat beranda dari origin yang sedang dipakai (aset lokal atau
                // server.url hosting), bukan alamat tetap https://localhost.
                webView.loadUrl(homeUrlFor(url));
                return;
            }
        } catch (Exception ignored) {
            // WebView sudah tidak bisa dipakai; tutup seperti perilaku normal.
        }
        finish();
    }

    /* Beranda = origin halaman saat ini + /index.html. Dipakai baik saat aplikasi
       memuat aset lokal maupun saat capacitor.config.json memakai server.url. */
    private String homeUrlFor(String currentUrl) {
        try {
            android.net.Uri parsed = android.net.Uri.parse(currentUrl);
            String scheme = parsed.getScheme();
            String authority = parsed.getAuthority();
            if (scheme != null && authority != null) {
                return scheme + "://" + authority + "/index.html";
            }
        } catch (Exception ignored) {
            // URL tidak bisa diurai; pakai aset lokal sebagai cadangan.
        }
        return "https://localhost/index.html";
    }


    
}
