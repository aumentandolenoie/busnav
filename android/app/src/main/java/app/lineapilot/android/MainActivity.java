package app.lineapilot.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;
import java.util.Set;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingOrigin;
    private WebViewAssetLoader assetLoader;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        web.addJavascriptInterface(new Bridge(this), "LineaPilotAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("appassets.androidplatform.net".equals(url.getHost())) return false;
                if ("http".equals(url.getScheme()) || "https".equals(url.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                    return true;
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingOrigin = origin;
                    pendingLocation = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, 42);
                }
            }
        });
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setLanguage(Locale.ITALIAN);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { notifySpeech(id, true); }
                    @Override public void onError(String id) { notifySpeech(id, false); }
                });
                web.post(() -> web.evaluateJavascript("window.loadItalianVoices && window.loadItalianVoices()", null));
            }
        });
        web.loadUrl(ORIGIN + "/assets/index.html");
    }

    private void notifySpeech(String token, boolean ok) {
        web.post(() -> web.evaluateJavascript("window.lineaPilotAndroidSpeechDone && window.lineaPilotAndroidSpeechDone(" +
            JSONObject.quote(token) + "," + ok + ")", null));
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 42 && pendingLocation != null) {
            boolean granted = false;
            for (int result : results) if (result == PackageManager.PERMISSION_GRANTED) granted = true;
            pendingLocation.invoke(pendingOrigin, granted, false);
            pendingLocation = null;
        }
    }

    @Override protected void onResume() {
        super.onResume();
        // Only when returning to foreground, with JS-side throttling.
        if (web != null) web.post(() -> web.evaluateJavascript(
            "window.lineaPilotCheckUpdatesOnResume && window.lineaPilotCheckUpdatesOnResume()", null));
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (web != null) { web.destroy(); }
        super.onDestroy();
    }

    private class Bridge {
        private final Context context;
        Bridge(Context context) { this.context = context; }

        @JavascriptInterface public String listVoices() {
            JSONArray voices = new JSONArray();
            if (!ttsReady || tts == null) return voices.toString();
            Set<android.speech.tts.Voice> list = tts.getVoices();
            if (list == null) return voices.toString();
            for (android.speech.tts.Voice voice : list) {
                if (!voice.getLocale().getLanguage().equals("it")) continue;
                JSONObject obj = new JSONObject();
                try {
                    obj.put("id",voice.getName());
                    obj.put("name",voice.getName());
                    obj.put("lang",voice.getLocale().toLanguageTag());
                    obj.put("quality",voice.getQuality());
                    obj.put("enhanced",voice.getQuality() >= android.speech.tts.Voice.QUALITY_HIGH);
                    voices.put(obj);
                } catch (Exception ignored) {}
            }
            return voices.toString();
        }

        @JavascriptInterface public void speak(String message, String voiceId, double rate, String token) {
            if (!ttsReady || tts == null || message.length() > 500 || !token.matches("[0-9]{1,12}")) {
                notifySpeech(token, false);
                return;
            }
            String wanted = voiceId;
            web.post(() -> {
                if (!wanted.isEmpty()) {
                    Set<android.speech.tts.Voice> voices = tts.getVoices();
                    if (voices != null) {
                        for (android.speech.tts.Voice voice : voices) {
                            if (voice.getName().equals(wanted) && voice.getLocale().getLanguage().equals("it")) {
                                tts.setVoice(voice);break;
                            }
                        }
                    }
                } else tts.setLanguage(Locale.ITALIAN);
                tts.setSpeechRate((float)Math.max(0.75,Math.min(1.25,rate)));
                Bundle params = new Bundle();
                if (tts.speak(message,TextToSpeech.QUEUE_FLUSH,params,token) == TextToSpeech.ERROR)
                    notifySpeech(token, false);
            });
        }

        @JavascriptInterface public void stopSpeech() {
            web.post(() -> { if (tts != null) tts.stop(); });
        }

        @JavascriptInterface public void openExternal(String value) {
            Uri uri = Uri.parse(value);
            if (!"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost()) ||
                !uri.getPath().startsWith("/aumentandolenoie/busnav/releases/download/")) return;
            web.post(() -> startActivity(new Intent(Intent.ACTION_VIEW, uri)));
        }
    }
}
