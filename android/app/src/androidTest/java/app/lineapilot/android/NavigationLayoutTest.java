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
            scenario.onActivity(a->{
                assertNotNull(a.session);DriverView screen=a.session.screen;screen.progress(0,0,true,0);
                List<View> controls=new ArrayList<>();collect(screen,controls);assertEquals(5,controls.size());
                Rect bounds=new Rect();assertTrue(screen.getGlobalVisibleRect(bounds));List<Rect> rectangles=new ArrayList<>();float d=a.getResources().getDisplayMetrics().density;
                for(View control:controls){Rect r=new Rect();assertTrue(control.getGlobalVisibleRect(r));assertTrue(control.getWidth()>=48*d-1);assertTrue(control.getHeight()>=48*d-1);assertTrue("Outside safe content: "+control.getTag(),bounds.contains(r));for(Rect other:rectangles)assertFalse("Overlapping controls",Rect.intersects(r,other));rectangles.add(r);}
                assertTrue(a.session.screen.nativeMap.mapView instanceof org.maplibre.android.maps.MapView);
                a.endNavigation();assertNull(a.session);
            });
        }
    }
    private void collect(View root,List<View> out){if(root.getTag()!=null&&root.getTag().toString().startsWith("nav-"))out.add(root);if(root instanceof ViewGroup){ViewGroup group=(ViewGroup)root;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),out);}}
}
