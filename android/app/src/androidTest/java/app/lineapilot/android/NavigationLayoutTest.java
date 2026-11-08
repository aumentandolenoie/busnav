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
    private void collect(View root,List<View> out){if(root.getTag()!=null&&root.getTag().toString().startsWith("nav-"))out.add(root);if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),out);}}
}
