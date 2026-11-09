package app.lineapilot.android;
import android.content.Intent;
import android.graphics.Rect;
import android.view.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.*;
import java.util.*;
import static org.junit.Assert.*;
@RunWith(AndroidJUnit4.class) public class NavigationLayoutTest {
    @Test public void nativePreviewAndControlsRespectSystemBars()throws Exception{
        Intent intent=new Intent(ApplicationProvider.getApplicationContext(),MainActivity.class).putExtra("layoutTest",true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(intent)){
            scenario.onActivity(a->{assertNotNull(a.previewMap);assertTrue(a.previewMap.mapView instanceof org.maplibre.android.maps.MapView);
                try{
                    JSONObject route=new JSONObject("{\"name\":\"Test\",\"points\":[[45,11],[45,11.01]],\"offsets\":[700],\"stops\":[\"PADOVA AUTOSTAZIONE CAPOLINEA PROVVISORIO VIALE DELLA STAZIONE\"],\"coverage\":{\"ranges\":[[0,787]],\"complete\":true,\"percent\":100},\"turns\":[{\"at\":300,\"side\":\"destra\",\"kind\":\"roundabout\",\"verifiedRoad\":true,\"text\":\"Alla prossima rotonda prendi la terza uscita in direzione Aeroporto Marco Polo\"}]}");
                    JSONObject body=new JSONObject();body.put("route",route);body.put("voice",false);a.startNavigation(body);
                }catch(Exception e){throw new AssertionError(e);}
            });
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            java.util.concurrent.atomic.AtomicBoolean mapReady=new java.util.concurrent.atomic.AtomicBoolean();
            for(int attempt=0;attempt<100&&!mapReady.get();attempt++){
                scenario.onActivity(a->mapReady.set(a.session!=null&&a.session.screen.nativeMap.map!=null&&a.session.screen.nativeMap.map.getStyle()!=null&&a.session.screen.nativeMap.map.getStyle().getSource("gpx")!=null));
                if(!mapReady.get())Thread.sleep(100);
            }
            assertTrue("Native map style failed to initialize",mapReady.get());
            scenario.onActivity(a->a.session.screen.progress(0,0,true,0));
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a->{
                assertNotNull(a.session);DriverView screen=a.session.screen;
                List<View> controls=new ArrayList<>();collect(screen,controls);assertEquals(5,controls.size());
                Rect bounds=new Rect();assertTrue(screen.getGlobalVisibleRect(bounds));List<Rect> rectangles=new ArrayList<>();float d=a.getResources().getDisplayMetrics().density;
                for(View control:controls){Rect r=new Rect();assertTrue(control.getGlobalVisibleRect(r));int[] position=new int[2];control.getLocationOnScreen(position);Rect full=new Rect(position[0],position[1],position[0]+control.getWidth(),position[1]+control.getHeight());assertEquals("Clipped control: "+control.getTag(),full,r);assertTrue("Outside safe content: "+control.getTag(),bounds.contains(full));assertTrue(control.getWidth()>=48*d-1);assertTrue(control.getHeight()>=48*d-1);assertTrue("Outside safe content: "+control.getTag(),bounds.contains(r));for(Rect other:rectangles)assertFalse("Overlapping controls",Rect.intersects(r,other));rectangles.add(r);}
                assertTrue(a.session.screen.nativeMap.mapView instanceof org.maplibre.android.maps.MapView);
            });
            final int[] touch=new int[2];
            scenario.onActivity(a->{DriverView screen=a.session.screen;int[] origin=new int[2];screen.getLocationOnScreen(origin);touch[0]=origin[0]+screen.getWidth()/2;touch[1]=origin[1]+(screen.getChildAt(1).getBottom()+screen.getChildAt(2).getTop())/2;});
            android.app.UiAutomation automation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation();
            long down=android.os.SystemClock.uptimeMillis();
            for(int i=0;i<=12;i++){
                int action=i==0?MotionEvent.ACTION_DOWN:i==12?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE;
                MotionEvent event=MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,touch[0]-i*8,touch[1],0);automation.injectInputEvent(event,true);event.recycle();android.os.SystemClock.sleep(20);
            }
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a->{
                DriverView screen=a.session.screen;
                org.maplibre.android.geometry.LatLng before=screen.nativeMap.map.getCameraPosition().target;
                android.location.Location fix=new android.location.Location("test");fix.setLatitude(45.02);fix.setLongitude(11.03);
                screen.location(fix,true,0);
                org.maplibre.android.geometry.LatLng after=screen.nativeMap.map.getCameraPosition().target;
                assertEquals("GPS must not recenter after a drag",before.getLatitude(),after.getLatitude(),0.000001);
                assertEquals(before.getLongitude(),after.getLongitude(),0.000001);
                screen.findViewWithTag("nav-center").performClick();
                assertEquals(45.02,screen.nativeMap.map.getCameraPosition().target.getLatitude(),0.00001);
                assertEquals(11.03,screen.nativeMap.map.getCameraPosition().target.getLongitude(),0.00001);
            });
            android.graphics.Bitmap screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            scenario.onActivity(a->{
                try{
                    android.content.ContentValues values=new android.content.ContentValues();
                    values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,a.getResources().getConfiguration().fontScale>1.1?"lineapilot-navigation-large.png":"lineapilot-navigation-standard.png");
                    values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE,"image/png");
                    values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,android.os.Environment.DIRECTORY_DOWNLOADS);
                    android.net.Uri uri=a.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
                    try(java.io.OutputStream output=a.getContentResolver().openOutputStream(uri)){assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output));}
                }catch(Exception e){throw new AssertionError(e);}
                a.endNavigation();assertNull(a.session);
            });
        }
    }
    @Test public void voiceChainsTheNextEventInRouteOrder() throws Exception {
        NativeRoute stopFirst = voiceRoute(340, 360, "[[0,700]]");
        NativeRoute.Continuation stop = stopFirst.continuation(0, 100, 0);
        assertNotNull(stop);
        assertTrue(stop.isStop);
        assertEquals("Tra circa 200 metri, alla rotonda, prendi la seconda uscita, poi prossima fermata: Padova Autostazione.",
                NativeRoute.voiceMessage(stopFirst.turns.get(0).text, 200.0, stop));

        NativeRoute turnFirst = voiceRoute(420, 360, "[[0,700]]");
        NativeRoute.Continuation turn = turnFirst.continuation(0, 100, 0);
        assertNotNull(turn);
        assertFalse(turn.isStop);
        assertEquals("Svolta a destra, poi svolta a sinistra.", NativeRoute.voiceMessage("Svolta a destra.", null, turn));
        assertNull(voiceRoute(280, 360, "[[0,700]]").continuation(0, 100, 0));
        assertNull(voiceRoute(420, 405, "[[0,700]]").continuation(0, 100, 0));
        assertNull(voiceRoute(420, 360, "[[0,320],[330,700]]").continuation(0, 100, 0));
    }

    private NativeRoute voiceRoute(double stopAt, double secondAt, String ranges) throws JSONException {
        JSONObject route = new JSONObject("{\"points\":[[45,11],[45,11.01]],\"stops\":[\"Padova Autostazione\"],"
                + "\"turns\":[{\"at\":300,\"side\":\"rotatoria\",\"text\":\"Alla rotonda, prendi la seconda uscita.\",\"verifiedRoad\":true},"
                + "{\"at\":" + secondAt + ",\"side\":\"sinistra\",\"text\":\"Svolta a sinistra.\",\"verifiedRoad\":true}]}");
        route.put("offsets", new JSONArray().put(stopAt));
        route.put("coverage", new JSONObject().put("ranges", new JSONArray(ranges)));
        return new NativeRoute(route);
    }

    @Test public void basemapLoadsWithOfficialNavigationLayers() throws Exception {
        Intent intent = new Intent(ApplicationProvider.getApplicationContext(), MainActivity.class);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            scenario.onActivity(activity -> activity.previewMap.show(
                    new double[][]{{45.4064,11.8768},{45.4084,11.8768}},
                    new double[][]{{45.4084,11.8768}}, new String[]{"Fermata di prova"}));
            java.util.concurrent.atomic.AtomicBoolean ready = new java.util.concurrent.atomic.AtomicBoolean();
            for (int i = 0; i < 160 && !ready.get(); i++) {
                scenario.onActivity(activity -> {
                    if (activity.previewMap.map == null) return;
                    org.maplibre.android.maps.Style style = activity.previewMap.map.getStyle();
                    ready.set(style != null && style.getLayer("gpx-line") != null);
                });
                if (!ready.get()) Thread.sleep(100);
            }
            assertTrue("Official route layers must be available", ready.get());
            scenario.onActivity(activity -> {
                org.maplibre.android.maps.Style style = activity.previewMap.map.getStyle();
                assertNotNull(style.getLayer("stop-dots"));
                assertNotNull(style.getLayer("gps-dot"));
                if (style.getSource("openmaptiles") != null) {
                    assertTrue(style.getLayer("building-3d") instanceof org.maplibre.android.style.layers.FillExtrusionLayer);
                    assertTrue(style.getLayer("poi_r20") instanceof org.maplibre.android.style.layers.SymbolLayer);
                    android.util.Log.i("LineaPilotMap", "OpenFreeMap style loaded with 3D buildings, POIs and GPX overlays");
                } else {
                    assertNotNull("Offline style must fall back to raster", style.getSource("osm"));
                    android.util.Log.i("LineaPilotMap", "Raster fallback loaded with GPX overlays");
                }
            });
        }
    }

    private void collect(View root,List<View> out){if(root.getTag()!=null&&root.getTag().toString().startsWith("nav-"))out.add(root);if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),out);}}
}
