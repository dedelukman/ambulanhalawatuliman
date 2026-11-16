package com.halawatuliman.siambulans;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
                webView.loadUrl("https://localhost/index.html");
                return;
            }
        } catch (Exception ignored) {
            // WebView sudah tidak bisa dipakai; tutup seperti perilaku normal.
        }
        finish();
    }
}
