package app.lineapilot.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.media.*;
import android.view.*;
import android.widget.*;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
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
    private FrameLayout root,preview;
    NativeMap previewMap;
    NavigationSession session;
    private PreviewLocation previewLocation;
    boolean layoutTest;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean navigationFocus;
    private String voiceIdentifier="";
    private double voiceRate=1;
    private long speechSerial;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingOrigin;
    private WebViewAssetLoader assetLoader;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        layoutTest=BuildConfig.DEBUG&&getIntent().getBooleanExtra("layoutTest",false);
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(245,245,247));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(i.left,i.top,i.right,i.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            if(Build.VERSION.SDK_INT>=30&&v.getWindowInsetsController()!=null)v.getWindowInsetsController().setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            else if(Build.VERSION.SDK_INT<30)v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            v.post(this::layoutPreparation);return insets;
        });
        if(Build.VERSION.SDK_INT>=30&&getWindow().getInsetsController()!=null)getWindow().getInsetsController().setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        root.requestApplyInsets();
        web = new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        preview=new FrameLayout(this);previewMap=new NativeMap(this,savedInstanceState,layoutTest);preview.addView(previewMap,new FrameLayout.LayoutParams(-1,-1));
        TextView caption=new TextView(this);caption.setText("Anteprima · GPX ufficiale");caption.setTextSize(12);caption.setTextColor(Color.DKGRAY);caption.setPadding(dp(8),dp(6),dp(8),dp(6));caption.setBackgroundColor(0xeeffffff);FrameLayout.LayoutParams cp=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.START);cp.setMargins(dp(12),dp(8),dp(64),0);preview.addView(caption,cp);
        previewLocation=new PreviewLocation(this,previewMap);
        ImageButton fit=new ImageButton(this);fit.setImageDrawable(new NavigationIcon("location",Color.rgb(0,122,255)));fit.setScaleType(ImageView.ScaleType.FIT_CENTER);fit.setContentDescription("Centra posizione attuale");fit.setTag("preview-center");fit.setPadding(dp(12),dp(12),dp(12),dp(12));fit.setMinimumWidth(dp(48));GradientDrawable bg=new GradientDrawable();bg.setColor(Color.WHITE);bg.setCornerRadius(dp(12));fit.setBackground(bg);fit.setOnClickListener(v->centerPreview());FrameLayout.LayoutParams fp=new FrameLayout.LayoutParams(dp(48),dp(48),Gravity.TOP|Gravity.END);fp.setMargins(0,dp(8),dp(12),0);preview.addView(fit,fp);
        root.addView(preview,new FrameLayout.LayoutParams(-1,dp(240),Gravity.BOTTOM));root.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->layoutPreparation());
        audio=(AudioManager)getSystemService(AUDIO_SERVICE);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setOnAudioFocusChangeListener(change->{if(change==AudioManager.AUDIOFOCUS_LOSS||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)stopNativeSpeech();}).build();
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
            @Override public void onPageFinished(WebView view,String url){send("previewReady",new JSONObject());}
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
                if(!ORIGIN.equals(origin)){callback.invoke(origin,false,false);return;}
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
                int language=tts.setLanguage(Locale.ITALIAN);
                ttsReady=language!=TextToSpeech.LANG_MISSING_DATA&&language!=TextToSpeech.LANG_NOT_SUPPORTED;
                tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { speechEvent(id,true,true); }
                    @Override public void onDone(String id) { speechEvent(id,false,true); }
                    @Override public void onError(String id) { speechEvent(id,false,false); }
                    @Override public void onStop(String id,boolean interrupted){speechEvent(id,false,false);}
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
        if(requestCode==44){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED)previewLocation.request();else Toast.makeText(this,"Abilita Posizione nelle Impostazioni",Toast.LENGTH_LONG).show();}
        if(requestCode==43&&session!=null){boolean granted=false;for(int result:results)if(result==PackageManager.PERMISSION_GRANTED)granted=true;if(granted)session.resume();else session.screen.message("GPS non autorizzato");}
        if (requestCode == 42 && pendingLocation != null) {
            boolean granted = false;
            for (int result : results) if (result == PackageManager.PERMISSION_GRANTED) granted = true;
            pendingLocation.invoke(pendingOrigin, granted, false);
            pendingLocation = null;
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if(previewMap!=null&&session==null)previewMap.start();
        if(session!=null){session.screen.nativeMap.start();session.resume();}
        // Only when returning to foreground, with JS-side throttling.
        if (web != null) web.post(() -> web.evaluateJavascript(
            "window.lineaPilotCheckUpdatesOnResume && window.lineaPilotCheckUpdatesOnResume()", null));
    }

    @Override public void onBackPressed() {
        if(session!=null){endNavigation();return;}
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onPause(){if(previewLocation!=null)previewLocation.cancel();if(session!=null){session.pause();session.screen.nativeMap.pause();}if(previewMap!=null)previewMap.pause();super.onPause();}
    @Override public void onLowMemory(){super.onLowMemory();if(previewMap!=null)previewMap.lowMemory();if(session!=null)session.screen.nativeMap.lowMemory();}
    @Override protected void onDestroy() {
        if(session!=null){session.stop();session.screen.nativeMap.destroy();session=null;}
        if(previewMap!=null)previewMap.destroy();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (web != null) { web.destroy(); }
        super.onDestroy();
    }

    private void centerPreview(){
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},44);return;}
        previewLocation.request();
    }
    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void layoutPreparation(){
        if(root==null||preview==null)return;int h=root.getHeight()-root.getPaddingTop()-root.getPaddingBottom();if(h<=0)return;
        int ph=Math.round(h*.38f),wh=h-ph-dp(8);
        FrameLayout.LayoutParams wp=(FrameLayout.LayoutParams)web.getLayoutParams();if(wp.height!=wh){wp.height=wh;wp.gravity=Gravity.TOP;web.setLayoutParams(wp);}
        FrameLayout.LayoutParams pp=(FrameLayout.LayoutParams)preview.getLayoutParams();if(pp.height!=ph){pp.height=ph;preview.setLayoutParams(pp);}
    }
    void send(String event,JSONObject data){if(web!=null)web.post(()->web.evaluateJavascript("window.lineaPilotNativeReceive && window.lineaPilotNativeReceive("+JSONObject.quote(event)+","+data.toString()+")",null));}
    private void error(String text){JSONObject data=new JSONObject();try{data.put("message",text);}catch(Exception ignored){}send("error",data);}
    void startNavigation(JSONObject body){
        try{
            NativeRoute route=new NativeRoute(body.getJSONObject("route"));route.tickets=TicketData.resolve(this,body.getJSONObject("route").optJSONObject("tickets"),route.ticketRoute);endNavigation(false);
            ((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0);web.clearFocus();
            previewLocation.cancel();configureVoice(body);previewMap.pause();preview.setVisibility(View.INVISIBLE);web.setVisibility(View.INVISIBLE);
            session=new NavigationSession(this,route,body.optBoolean("voice",true),body.optBoolean("turnVoice",true),body.optBoolean("demo",false));
            root.addView(session.screen,new FrameLayout.LayoutParams(-1,-1));getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);session.screen.nativeMap.start();session.resume();
        }catch(Exception e){error("Percorso nativo non valido: "+e.getMessage());}
    }
    void endNavigation(){endNavigation(true);}
    private void endNavigation(boolean notify){
        if(session!=null){session.screen.dismissTickets();session.stop();root.removeView(session.screen);session.screen.nativeMap.destroy();session=null;}
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);if(web!=null)web.setVisibility(View.VISIBLE);if(preview!=null)preview.setVisibility(View.VISIBLE);if(previewMap!=null)previewMap.start();
        if(notify)send("ended",new JSONObject());
    }
    private void configureVoice(JSONObject body){voiceIdentifier=body.optString("voiceId",voiceIdentifier);double rate=body.optDouble("rate",voiceRate);if(Double.isFinite(rate))voiceRate=Math.max(.75,Math.min(1.25,rate));}
    private void selectVoice(String wanted){
        if(tts==null)return;Set<android.speech.tts.Voice> voices=tts.getVoices();android.speech.tts.Voice selected=null;
        if(voices!=null)for(android.speech.tts.Voice v:voices){
            if(!"it".equals(v.getLocale().getLanguage())||(v.getFeatures()!=null&&v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)))continue;
            if(v.getName().equals(wanted)){selected=v;break;}
            if(selected==null||(!v.isNetworkConnectionRequired()&&selected.isNetworkConnectionRequired())||(v.isNetworkConnectionRequired()==selected.isNetworkConnectionRequired()&&v.getQuality()>selected.getQuality()))selected=v;
        }
        if(selected!=null)tts.setVoice(selected);else tts.setLanguage(Locale.ITALIAN);
    }
    boolean navigationSpeaking(){return tts!=null&&tts.isSpeaking();}
    double speechRate(){return voiceRate;}
    // Low-level TTS for native navigation. The queue (VoiceCueQueue) lives in
    // NavigationSession: this is only called when nothing else is being read,
    // so QUEUE_FLUSH never cuts a cue off any more.
    String startNavigationUtterance(String text){
        if(!ttsReady||tts==null||text==null||text.isEmpty()||text.length()>2000)return null;
        if(!navigationFocus){if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)return null;navigationFocus=true;}
        selectVoice(voiceIdentifier);tts.setSpeechRate((float)voiceRate);
        String id="nav-"+(++speechSerial);
        if(tts.speak(text,TextToSpeech.QUEUE_FLUSH,new Bundle(),id)==TextToSpeech.ERROR){releaseNavigationAudio();return null;}
        return id;
    }
    void cancelNavigationUtterance(){if(tts!=null)tts.stop();}
    void releaseNavigationAudio(){if(navigationFocus&&audio!=null&&focus!=null){audio.abandonAudioFocusRequest(focus);navigationFocus=false;}}
    /** Manual request (test voice): replaces whatever is queued. */
    boolean speakNavigation(String text){
        if(session!=null){session.speakNow(text);return true;}
        cancelNavigationUtterance();
        return startNavigationUtterance(text)!=null;
    }
    void stopNativeSpeech(){
        if(session!=null)session.flushVoice();
        else{cancelNavigationUtterance();releaseNavigationAudio();}
    }
    private void speechEvent(String id,boolean started,boolean ok){web.post(()->{
        if(id!=null&&id.startsWith("nav-")){
            if(session!=null){if(started)session.onSpeechStarted(id);else session.onSpeechEnded(id,ok);}
            else if(!started&&id.equals("nav-"+speechSerial))releaseNavigationAudio();
        }else if(!started)notifySpeech(id,ok);
    });}
    private void handleMessage(JSONObject body){
        switch(body.optString("type")){
            case "previewRoute":try{JSONObject r=body.optJSONObject("route");double[][] points=r==null?new double[0][2]:NativeRoute.coordinates(r.getJSONArray("points"));if(points.length>0)new GPXTracker(points);double[][] stops=r==null?new double[0][2]:NativeRoute.coordinates(r.optJSONArray("stopCoordinates"));JSONArray ss=r==null?null:r.optJSONArray("stops");String[] names=new String[ss==null?0:ss.length()];for(int i=0;i<names.length;i++)names[i]=ss.getString(i);previewMap.show(points,stops,names);send("previewReady",new JSONObject());}catch(Exception ignored){}break;
            case "start":startNavigation(body);break;
            case "stop":endNavigation(false);break;
            case "settings":configureVoice(body);if(session!=null){session.voice=body.optBoolean("voice",session.voice);session.turnVoice=body.optBoolean("turnVoice",session.turnVoice);if(!session.voice)stopNativeSpeech();}break;
            case "testVoice":speakNavigation("Tra duecento metri, alla rotonda, prendi la seconda uscita, poi prossima fermata: Padova Autostazione. Svolta a destra, poi svolta a sinistra.");break;
            case "openUpdate":new Bridge(this).openExternal(body.optString("url"));break;
            case "checkUpdates":new Thread(()->{try{HttpURLConnection connection=(HttpURLConnection)new URL("https://api.github.com/repos/aumentandolenoie/busnav/releases?per_page=40").openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setRequestProperty("Accept","application/vnd.github+json");try(java.io.InputStream in=connection.getInputStream()){java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)bytes.write(buffer,0,count);JSONArray releases=new JSONArray(new String(bytes.toByteArray(),StandardCharsets.UTF_8));JSONObject out=new JSONObject();out.put("releases",releases);send("releases",out);}finally{connection.disconnect();}}catch(Exception e){JSONObject out=new JSONObject();try{out.put("message",e.getMessage());}catch(Exception ignored){}send("updateError",out);}}).start();break;
        }
    }

    private class Bridge {
        private final Context context;
        Bridge(Context context) { this.context = context; }

        @JavascriptInterface public void postMessage(String value){
            if(value==null||value.length()>2000000)return;try{JSONObject body=new JSONObject(value);runOnUiThread(()->handleMessage(body));}catch(Exception ignored){}
        }
        @JavascriptInterface public String listVoices() {
            JSONArray voices = new JSONArray();
            if (!ttsReady || tts == null) return voices.toString();
            Set<android.speech.tts.Voice> list = tts.getVoices();
            if (list == null) return voices.toString();
            for (android.speech.tts.Voice voice : list) {
                if (!voice.getLocale().getLanguage().equals("it")) continue;
                if(voice.getFeatures()!=null&&voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))continue;
                JSONObject obj = new JSONObject();
                try {
                    obj.put("id",voice.getName());
                    obj.put("name",voice.getName());
                    obj.put("lang",voice.getLocale().toLanguageTag());
                    obj.put("quality",voice.getQuality());
                    obj.put("enhanced",voice.getQuality() >= android.speech.tts.Voice.QUALITY_HIGH);
                    obj.put("network",voice.isNetworkConnectionRequired());
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
                selectVoice(wanted);
                tts.setSpeechRate((float)Math.max(0.75,Math.min(1.25,rate)));
                Bundle params = new Bundle();
                if (tts.speak(message,TextToSpeech.QUEUE_FLUSH,params,token) == TextToSpeech.ERROR)
                    notifySpeech(token, false);
            });
        }

        @JavascriptInterface public void stopSpeech() {
            web.post(() -> stopNativeSpeech());
        }

        @JavascriptInterface public void openExternal(String value) {
            Uri uri = Uri.parse(value);
            if (!"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost()) ||
                !uri.getPath().startsWith("/aumentandolenoie/busnav/releases/download/")) return;
            web.post(() -> startActivity(new Intent(Intent.ACTION_VIEW, uri)));
        }
    }
}



