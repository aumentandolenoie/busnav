package app.lineapilot.android;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Bundle;
import android.text.Html;
import android.text.method.LinkMovementMethod;
import android.view.*;
import android.widget.*;
import org.maplibre.android.MapLibre;
import org.maplibre.android.camera.*;
import org.maplibre.android.geometry.*;
import org.maplibre.android.maps.*;
import org.maplibre.android.style.layers.*;
import org.maplibre.android.style.sources.GeoJsonSource;
import org.maplibre.android.module.http.HttpRequestUtil;
import org.maplibre.geojson.*;
import okhttp3.*;
import java.io.File;
import java.util.*;
import static org.maplibre.android.style.layers.PropertyFactory.*;

final class NativeMap extends FrameLayout {
    private static final String VECTOR_STYLE = "https://tiles.openfreemap.org/styles/liberty";
    private static final String EMPTY_STYLE = "{\"version\":8,\"sources\":{},\"layers\":[{\"id\":\"background\",\"type\":\"background\",\"paint\":{\"background-color\":\"#e7eceb\"}}]}";
    private static final String RASTER_STYLE = "{\"version\":8,\"sources\":{\"osm\":{\"type\":\"raster\",\"tiles\":[\"https://tile.openstreetmap.org/{z}/{x}/{y}.png\"],\"tileSize\":256,\"maxzoom\":19}},\"layers\":[{\"id\":\"osm\",\"type\":\"raster\",\"source\":\"osm\"}]}";
    private static final String OSM_CREDIT = "<a href=\"https://www.openstreetmap.org/copyright\">© OpenStreetMap contributors</a>";
    private static final String VECTOR_CREDIT = "<a href=\"https://openfreemap.org\">OpenFreeMap</a> · "
            + "<a href=\"https://openmaptiles.org\">© OpenMapTiles</a><br>" + OSM_CREDIT;
    private static final String[] POI_LAYERS = {"poi_r1", "poi_r7", "poi_r20", "poi_transit"};
    private static boolean initialized;
    final MapView mapView;MapLibreMap map;
    private double[][] route=new double[0][2],stops=new double[0][2];private String[] names=new String[0];
    Runnable onUserGesture;
    private double[] pendingCenter;
    private double[] fix;private double fixBearing=Double.NaN;private boolean pendingFit;
    private boolean started, destroyed, vectorStyle;
    private final TextView attribution;
    private final Runnable fallback = this::useRasterBasemap;
    private int mapLeftInset, mapTopInset, mapRightInset, mapBottomInset;
    static synchronized void initialize(Context context){
        if(initialized)return;MapLibre.getInstance(context.getApplicationContext());
        OkHttpClient client=new OkHttpClient.Builder().cache(new Cache(new File(context.getCacheDir(),"native-map-http"),64L*1024*1024))
            .addInterceptor(chain->chain.proceed(chain.request().newBuilder().header("User-Agent","LineaPilot/0.2 (Android; https://github.com/aumentandolenoie/busnav)").build())).build();
        HttpRequestUtil.setOkHttpClient(client);initialized=true;
    }
    NativeMap(Context c,Bundle state,boolean offlineTest){
        super(c);initialize(c);setTag("native-map");
        mapLeftInset=mapRightInset=dp(8);
        mapView=new MapView(c);addView(mapView,new LayoutParams(-1,-1));mapView.onCreate(state);
        attribution=new TextView(c);attribution.setMovementMethod(LinkMovementMethod.getInstance());setAttribution(false);attribution.setTextColor(Color.DKGRAY);attribution.setTextSize(10);attribution.setBackgroundColor(0xddffffff);attribution.setPadding(dp(4),dp(2),dp(4),dp(2));
        LayoutParams ap=new LayoutParams(-2,-2,Gravity.BOTTOM|Gravity.START);ap.setMargins(dp(8),0,0,dp(8));addView(attribution,ap);
        // Its height is known only after the first layout: re-centre it once measured.
        attribution.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{if(b-t!=ob-ot&&creditCenter>=0)post(()->setInsets(mapLeftInset,mapTopInset,mapRightInset,mapBottomInset,creditLeft,creditCenter));});
        mapView.getMapAsync(m->{
            if (destroyed) return;
            map=m;map.setPrefetchZoomDelta(0);
            map.addOnCameraMoveStartedListener(reason->{if(reason==MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE&&onUserGesture!=null)onUserGesture.run();});
            map.getUiSettings().setCompassEnabled(false);map.getUiSettings().setRotateGesturesEnabled(false);
            map.getUiSettings().setLogoEnabled(false);
            map.getUiSettings().setAttributionEnabled(false);
            map.getUiSettings().setTiltGesturesEnabled(true);
            map.setPadding(mapLeftInset,mapTopInset,mapRightInset,mapBottomInset);
            map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(45.4064,11.8768),11));
            if (pendingFit) fitRoute();
            if (pendingCenter != null) centerLocation(pendingCenter[0], pendingCenter[1]);
            map.addOnMapClickListener(this::onMapTap);

            if (offlineTest) {
                loadBasemap(new Style.Builder().fromJson(EMPTY_STYLE), false);
            } else {
                mapView.addOnDidFailLoadingMapListener(error -> post(fallback));
                postDelayed(fallback, 8000);
                loadBasemap(new Style.Builder().fromUri(VECTOR_STYLE), true);
            }
        });
    }

    private void setAttribution(boolean vector) {
        attribution.setText(Html.fromHtml(vector ? VECTOR_CREDIT : OSM_CREDIT, Html.FROM_HTML_MODE_LEGACY));
    }

    private void useRasterBasemap() {
        if (destroyed || !vectorStyle) return;
        loadBasemap(new Style.Builder().fromJson(RASTER_STYLE), false);
    }

    private void loadBasemap(Style.Builder builder, boolean vector) {
        vectorStyle = vector;
        setAttribution(vector);
        map.setStyle(builder, style -> {
            if (destroyed || vector != vectorStyle) return;
            removeCallbacks(fallback);
            style.addSource(new GeoJsonSource("gpx", FeatureCollection.fromFeatures(new Feature[0])));
            style.addLayer(new LineLayer("gpx-line", "gpx").withProperties(
                    lineColor("#007aff"), lineWidth(6f), lineCap("round"), lineJoin("round")));
            style.addSource(new GeoJsonSource("stops", FeatureCollection.fromFeatures(new Feature[0])));
            style.addLayer(new CircleLayer("stop-dots", "stops").withProperties(
                    circleColor("#007aff"), circleRadius(5f), circleStrokeColor("#ffffff"), circleStrokeWidth(2f)));
            style.addSource(new GeoJsonSource("gps", FeatureCollection.fromFeatures(new Feature[0])));
            style.addLayer(new CircleLayer("gps-dot", "gps").withProperties(
                    circleColor("#007aff"), circleRadius(10f), circleStrokeColor("#ffffff"), circleStrokeWidth(4f)));
            // While navigating: blue arrow lying on the road, like Google Maps.
            style.addImage("nav-arrow", navigationArrow());
            style.addSource(new GeoJsonSource("gps-heading", FeatureCollection.fromFeatures(new Feature[0])));
            style.addLayer(new SymbolLayer("gps-arrow", "gps-heading").withProperties(
                    iconImage("nav-arrow"), iconAllowOverlap(true), iconIgnorePlacement(true),
                    iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
                    iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_MAP), iconRotate(0f)));
            drawRoute();
            drawFix();
        });
    }

    private boolean onMapTap(LatLng location) {
        android.graphics.PointF screenPoint = map.getProjection().toScreenLocation(location);
        List<Feature> markers = map.queryRenderedFeatures(screenPoint, "stop-dots");
        if (!markers.isEmpty()) {
            Toast.makeText(getContext(), markers.get(0).getStringProperty("name"), Toast.LENGTH_SHORT).show();
            return true;
        }
        if (vectorStyle) {
            for (Feature poi : map.queryRenderedFeatures(screenPoint, POI_LAYERS)) {
                var name = poi.getProperty("name");
                if (name != null && name.isJsonPrimitive() && !name.getAsString().isEmpty()) {
                    Toast.makeText(getContext(), name.getAsString(), Toast.LENGTH_SHORT).show();
                    return true;
                }
            }
        }
        return false;
    }

    void show(double[][] p,double[][] s,String[] names){route=p;stops=s;this.names=names;drawRoute();pendingFit=true;post(this::fitRoute);}
    private void drawRoute(){
        if(map==null||map.getStyle()==null)return;Style style=map.getStyle();GeoJsonSource source=style.getSourceAs("gpx"),stopSource=style.getSourceAs("stops");if(source==null||stopSource==null)return;
        List<Point> ps=new ArrayList<>();for(double[] p:route)ps.add(Point.fromLngLat(p[1],p[0]));
        source.setGeoJson(ps.size()>1?FeatureCollection.fromFeatures(new Feature[]{Feature.fromGeometry(LineString.fromLngLats(ps))}):FeatureCollection.fromFeatures(new Feature[0]));
        List<Feature> features=new ArrayList<>();for(int i=0;i<stops.length;i++){double[] p=stops[i];if(!Double.isFinite(p[0])||!Double.isFinite(p[1]))continue;Feature f=Feature.fromGeometry(Point.fromLngLat(p[1],p[0]));f.addStringProperty("name",i<names.length?names[i]:"Fermata");features.add(f);}stopSource.setGeoJson(FeatureCollection.fromFeatures(features));
    }
    void location(double lat,double lon){location(lat,lon,Double.NaN);}
    /** With a finite bearing (degrees from north) the position is drawn as a navigation arrow. */
    void location(double lat,double lon,double bearing){fix=new double[]{lat,lon};fixBearing=bearing;drawFix();}
    private void drawFix(){
        if(map==null||map.getStyle()==null||fix==null)return;Style style=map.getStyle();
        GeoJsonSource dot=style.getSourceAs("gps"),heading=style.getSourceAs("gps-heading");
        Feature here=Feature.fromGeometry(Point.fromLngLat(fix[1],fix[0]));
        FeatureCollection none=FeatureCollection.fromFeatures(new Feature[0]);
        boolean arrow=Double.isFinite(fixBearing)&&heading!=null;
        if(dot!=null)dot.setGeoJson(arrow?none:FeatureCollection.fromFeatures(new Feature[]{here}));
        if(heading!=null)heading.setGeoJson(arrow?FeatureCollection.fromFeatures(new Feature[]{here}):none);
        Layer layer=style.getLayer("gps-arrow");
        if(arrow&&layer!=null)layer.setProperties(iconRotate((float)fixBearing));
    }
    /** Google Maps-style navigation arrow: blue chevron, white outline, soft shadow. */
    private Bitmap navigationArrow(){
        int side=dp(44);float u=side/100f;
        Bitmap bitmap=Bitmap.createBitmap(side,side,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);
        Path path=new Path();path.moveTo(50*u,10*u);path.lineTo(84*u,86*u);path.lineTo(50*u,69*u);path.lineTo(16*u,86*u);path.close();
        Paint outline=new Paint(Paint.ANTI_ALIAS_FLAG);outline.setStyle(Paint.Style.STROKE);outline.setStrokeJoin(Paint.Join.ROUND);
        outline.setStrokeWidth(13*u);outline.setColor(Color.WHITE);outline.setShadowLayer(5*u,0,2*u,0x55000000);
        canvas.drawPath(path,outline);
        Paint fill=new Paint(Paint.ANTI_ALIAS_FLAG);fill.setStyle(Paint.Style.FILL);fill.setColor(Color.rgb(26,115,232));
        canvas.drawPath(path,fill);
        return bitmap;
    }
    void centerLocation(double lat,double lon){
        location(lat,lon);pendingFit=false;pendingCenter=new double[]{lat,lon};
        if(map!=null){map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(lat,lon),17));pendingCenter=null;}
    }
    void fitRoute(){
        if(map==null||route.length<2||getWidth()==0||getHeight()==0)return;
        try{List<LatLng> ps=new ArrayList<>();for(double[] p:route)ps.add(new LatLng(p[0],p[1]));map.moveCamera(CameraUpdateFactory.newLatLngBounds(new LatLngBounds.Builder().includes(ps).build(),dp(28)));pendingFit=false;}catch(IllegalStateException ignored){pendingFit=true;}
    }
    @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);if(pendingFit)post(this::fitRoute);}
    int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    void setInsets(int left,int top,int right,int bottom){setInsets(left,top,right,bottom,left);}
    void setInsets(int left,int top,int right,int bottom,int attributionLeft){setInsets(left,top,right,bottom,attributionLeft,-1);}
    /** {@code attributionLeft} keeps the map credit beside a bottom-left button instead of under it;
     *  {@code attributionCenterFromBottom} (if >= 0) centres it vertically on that button. */
    private int creditLeft=-1,creditCenter=-1;
    void setInsets(int left,int top,int right,int bottom,int attributionLeft,int attributionCenterFromBottom){
        creditLeft=attributionLeft;creditCenter=attributionCenterFromBottom;
        if(map!=null&&!(left==mapLeftInset&&top==mapTopInset&&right==mapRightInset&&bottom==mapBottomInset))map.setPadding(left,top,right,bottom);
        mapLeftInset=left;mapTopInset=top;mapRightInset=right;mapBottomInset=bottom;
        int creditBottom=attributionCenterFromBottom>=0&&attribution.getMeasuredHeight()>0
                ?Math.max(0,attributionCenterFromBottom-attribution.getMeasuredHeight()/2):bottom;
        LayoutParams p=(LayoutParams)attribution.getLayoutParams();
        if(p.leftMargin!=attributionLeft||p.bottomMargin!=creditBottom){
            p.leftMargin=attributionLeft;p.bottomMargin=creditBottom;
            attribution.setLayoutParams(p);
        }
    }
    void start(){if(started||destroyed)return;mapView.onStart();mapView.onResume();started=true;}void pause(){if(!started||destroyed)return;mapView.onPause();mapView.onStop();started=false;}void destroy(){if(destroyed)return;pause();destroyed=true;removeCallbacks(fallback);mapView.onDestroy();}void lowMemory(){mapView.onLowMemory();}
}
