package app.lineapilot.android;

import android.app.Activity;
import android.location.*;
import android.os.*;
import android.widget.Toast;

// One requested fix: preview centering never enables continuous camera tracking.
final class PreviewLocation implements LocationListener {
    private final Activity activity;
    private final NativeMap map;
    private final LocationManager gps;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean waiting;
    private final Runnable timeout=()->{cancel();message("Posizione GPS non disponibile");};
    PreviewLocation(Activity activity,NativeMap map){this.activity=activity;this.map=map;gps=(LocationManager)activity.getSystemService(Activity.LOCATION_SERVICE);}
    void request(){
        cancel();waiting=true;
        try{
            boolean requested=false;
            for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
                if(!gps.isProviderEnabled(provider))continue;
                gps.requestLocationUpdates(provider,1000,0,this,Looper.getMainLooper());requested=true;
            }
            if(!requested){cancel();message("Attiva la posizione GPS del telefono");return;}
            message("Ricerca posizione GPS…");handler.postDelayed(timeout,20000);
        }catch(SecurityException e){cancel();message("Autorizza l’accesso alla posizione nelle Impostazioni");}
    }
    @Override public void onLocationChanged(Location fix){
        if(!waiting||!fix.hasAccuracy()||fix.getAccuracy()<0||fix.getAccuracy()>100||Math.abs(SystemClock.elapsedRealtimeNanos()-fix.getElapsedRealtimeNanos())>15000000000L)return;
        cancel();map.centerLocation(fix.getLatitude(),fix.getLongitude());
    }
    void cancel(){waiting=false;handler.removeCallbacks(timeout);if(gps!=null)try{gps.removeUpdates(this);}catch(SecurityException ignored){}}
    private void message(String text){Toast.makeText(activity,text,Toast.LENGTH_SHORT).show();}
    @Override public void onProviderEnabled(String p){} @Override public void onProviderDisabled(String p){} @Override public void onStatusChanged(String p,int s,Bundle b){}
}
