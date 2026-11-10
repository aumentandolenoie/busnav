package app.lineapilot.android;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.view.*;
import android.widget.*;
import org.maplibre.android.camera.*;
import org.maplibre.android.geometry.LatLng;
import java.util.Locale;

final class DriverView extends FrameLayout {
    final NativeMap nativeMap;final NavigationSession session;
    final TextView distance,instruction,stopName,stopDistance,status;final ImageView symbol;
    private final TextView roadStatus,speedSign;
    private final ImageButton north;
    private boolean landscape;
    private final double[] followPadding=new double[4];
    private final BoundedScroll topText,bottomText;private final LinearLayout top,bottom;
    private boolean following=true;private double heading;private Location lastFix;
    DriverView(MainActivity c,NavigationSession s,boolean test){
        super(c);session=s;setTag("driver-screen");setBackgroundColor(Color.WHITE);
        nativeMap=new NativeMap(c,null,test);addView(nativeMap,new LayoutParams(-1,-1));nativeMap.show(s.route.points,s.route.stopCoordinates,s.route.stops);
        nativeMap.onUserGesture=()->following=false;
        top=card(c,Color.rgb(20,57,40));top.setOrientation(LinearLayout.HORIZONTAL);top.setGravity(Gravity.CENTER_VERTICAL);
        symbol=new ImageView(c);symbol.setImageDrawable(new NavigationIcon("forward",Color.WHITE));symbol.setScaleType(ImageView.ScaleType.FIT_CENTER);top.addView(symbol,new LinearLayout.LayoutParams(dp(36),dp(48)));
        topText=new BoundedScroll(c);LinearLayout texts=column(c);distance=label(c,"Attesa GPS",36,Color.WHITE,true);distance.setMaxLines(1);distance.setEllipsize(android.text.TextUtils.TruncateAt.END);instruction=label(c,"Segui il percorso ufficiale",25,Color.WHITE,true);instruction.setMaxLines(3);instruction.setEllipsize(android.text.TextUtils.TruncateAt.END);texts.addView(distance);texts.addView(instruction);topText.addView(texts);
        LinearLayout.LayoutParams tf=new LinearLayout.LayoutParams(0,-2,1);tf.setMargins(dp(10),0,dp(8),0);top.addView(topText,tf);
        ImageButton repeat=iconButton(c,"sound",Color.WHITE,"Ripeti indicazione","nav-repeat",()->s.repeat());top.addView(repeat,new LinearLayout.LayoutParams(dp(48),dp(48)));
        LayoutParams tp=new LayoutParams(-1,-2,Gravity.TOP);tp.setMargins(dp(12),dp(8),dp(12),0);addView(top,tp);
        bottom=card(c,Color.rgb(250,250,252));bottom.setOrientation(LinearLayout.VERTICAL);bottomText=new BoundedScroll(c);
        LinearLayout info=column(c);info.addView(label(c,"PROSSIMA FERMATA",12,Color.GRAY,true));stopName=label(c,s.route.stops.length>0?s.route.stops[0]:"Solo percorso GPX",24,Color.BLACK,true);stopName.setMaxLines(2);stopName.setEllipsize(android.text.TextUtils.TruncateAt.END);info.addView(stopName);
        stopDistance=label(c,"",19,Color.rgb(0,122,255),true);info.addView(stopDistance);
        roadStatus=label(c,"",13,Color.DKGRAY,true);
        roadStatus.setMaxLines(2);
        roadStatus.setVisibility(GONE);
        info.addView(roadStatus);
        status=label(c,"GPX ufficiale · GPS in primo piano",13,Color.DKGRAY,false);status.setMaxLines(2);info.addView(status);info.addView(label(c,"GPX Academy · manovre © OpenStreetMap contributors",10,Color.GRAY,false));
        bottomText.addView(info);bottom.addView(bottomText,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout controls=new LinearLayout(c);controls.setGravity(Gravity.CENTER_VERTICAL);controls.setPadding(0,dp(8),0,0);
        Button end=button(c,"Termina","Termina navigazione","nav-end",c::endNavigation);end.setTextColor(Color.rgb(235,60,60));controls.addView(end,new LinearLayout.LayoutParams(-2,dp(48)));
        View spacer=new View(c);controls.addView(spacer,new LinearLayout.LayoutParams(0,1,1));
        ImageButton sound=iconButton(c,s.voice?"sound":"muted",Color.rgb(0,122,255),"Attiva o disattiva annunci","nav-sound",null);sound.setOnClickListener(v->{s.voice=!s.voice;if(!s.voice)c.stopNativeSpeech();sound.setImageDrawable(new NavigationIcon(s.voice?"sound":"muted",Color.rgb(0,122,255)));});controls.addView(sound,new LinearLayout.LayoutParams(dp(48),dp(48)));
        ImageButton center=iconButton(c,"location",Color.rgb(0,122,255),"Centra GPS","nav-center",()->{following=true;if(lastFix!=null)location(lastFix,session.matched,session.along);else nativeMap.fitRoute();});controls.addView(center,new LinearLayout.LayoutParams(dp(48),dp(48)));bottom.addView(controls);
        LayoutParams bp=new LayoutParams(-1,-2,Gravity.BOTTOM);bp.setMargins(dp(12),0,dp(12),dp(8));addView(bottom,bp);
        north=iconButton(c,"north",Color.DKGRAY,"Orienta a nord","nav-north",()->{if(nativeMap.map!=null)nativeMap.map.animateCamera(CameraUpdateFactory.bearingTo(0));following=false;});
        north.setBackground(background(Color.WHITE));
        addView(north,new LayoutParams(dp(48),dp(48)));
        speedSign=new TextView(c);
        speedSign.setTag("nav-speed-limit");
        speedSign.setGravity(Gravity.CENTER);
        speedSign.setTextColor(Color.BLACK);
        speedSign.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        speedSign.setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP,19);
        GradientDrawable sign=new GradientDrawable();
        sign.setShape(GradientDrawable.OVAL);
        sign.setColor(Color.WHITE);
        sign.setStroke(dp(4),Color.rgb(212,26,33));
        speedSign.setBackground(sign);
        speedSign.setVisibility(INVISIBLE);
        speedSign.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        addView(speedSign,new LayoutParams(dp(46),dp(46)));
    }

    @Override protected void onMeasure(int widthSpec,int heightSpec){
        int width=MeasureSpec.getSize(widthSpec),height=MeasureSpec.getSize(heightSpec);
        landscape=width>height;
        int column=landscape?Math.min(dp(280),Math.max(dp(210),Math.round(width*.38f))):LayoutParams.MATCH_PARENT;
        for(LinearLayout panel:new LinearLayout[]{top,bottom}){
            LayoutParams params=(LayoutParams)panel.getLayoutParams();
            params.width=column;
            params.gravity=(panel==top?Gravity.TOP:Gravity.BOTTOM)|Gravity.LEFT;
        }
        int budget=Math.max(dp(144),height-dp(landscape?24:76));
        int topHeight=Math.max(dp(72),Math.round(budget*.42f));
        topText.setLimit(topHeight-dp(24));
        bottomText.setLimit(Math.max(0,budget-topHeight-dp(80)));
        super.onMeasure(widthSpec,heightSpec);
    }

    @Override protected void onLayout(boolean changed,int l,int t,int r,int b){
        super.onLayout(changed,l,t,r,b);
        int controlsBottom=landscape?getHeight()-dp(12):bottom.getTop()-dp(8);
        int right=getWidth()-dp(12), buttonSize=dp(48), signSize=dp(46);
        north.layout(right-buttonSize,controlsBottom-buttonSize,right,controlsBottom);
        int signRight=right-buttonSize-dp(8);
        speedSign.layout(signRight-signSize,controlsBottom-signSize-dp(1),signRight,controlsBottom-dp(1));
        int leftInset=landscape?top.getRight()+dp(8):dp(8);
        int topInset=landscape?dp(8):top.getBottom()+dp(8);
        int bottomInset=landscape?dp(8):getHeight()-bottom.getTop()+dp(8);
        int visibleHeight=Math.max(0,getHeight()-topInset-bottomInset);
        int paddedTop=topInset+Math.round(visibleHeight*.26f),rightInset=dp(8);
        boolean viewportChanged=followPadding[0]!=leftInset||followPadding[1]!=paddedTop
                ||followPadding[2]!=rightInset||followPadding[3]!=bottomInset;
        followPadding[0]=leftInset;followPadding[1]=paddedTop;
        followPadding[2]=rightInset;followPadding[3]=bottomInset;
        nativeMap.setInsets(leftInset,topInset,rightInset,bottomInset);
        if(viewportChanged&&following&&lastFix!=null)location(lastFix,session.matched,session.along);
    }

    void message(String text){status.setText(text);}
    void progress(double along,int stop,boolean reliable,double deviation){
        int limit = reliable && lastFix != null && lastFix.hasAccuracy()
                ? session.route.speedLimit(along,lastFix.getAccuracy(),deviation) : 0;
        speedSign.setVisibility(limit > 0 ? VISIBLE : INVISIBLE);
        speedSign.setText(limit > 0 ? Integer.toString(limit) : "");
        speedSign.setContentDescription(limit > 0 ? "Limite di velocità " + limit + " chilometri orari" : null);
        String roadDetails = "";
        if (reliable && deviation < 45) {
            int index = session.route.nextCamera(along, 350, java.util.Collections.emptySet());
            if (index >= 0) {
                NativeRoute.Camera camera = session.route.cameras.get(index);
                roadDetails = camera.title + " · " + metres(camera.at - along);
            }
        }
        roadStatus.setText(roadDetails);
        roadStatus.setVisibility(roadDetails.isEmpty() ? GONE : VISIBLE);
        if(!reliable){distance.setText("Annunci sospesi");instruction.setText(deviation>85?"Fuori dal percorso ufficiale":"Verifica posizione GPS");symbol.setImageDrawable(new NavigationIcon("warning",Color.WHITE));return;}
        NativeRoute.Turn next=session.route.nextTurn(along);if(next!=null){distance.setText(metres(Math.max(0,next.at-along)));instruction.setText(next.text);symbol.setImageDrawable(new NavigationIcon("roundabout".equals(next.kind)?"roundabout":"sinistra".equals(next.side)?"left":"right",Color.WHITE));}
        else{boolean covered=session.route.covered(along,along);distance.setText(covered?metres(session.tracker.total()-along):"Tratto non coperto");instruction.setText(covered?"Segui il GPX ufficiale":"Manovre non disponibili qui: segui il GPX ufficiale");symbol.setImageDrawable(new NavigationIcon("forward",Color.WHITE));}
        if(stop<session.route.stops.length){stopName.setText(session.route.stops[stop]);stopDistance.setText(metres(Math.max(0,session.route.offsets[stop]-along))+" · fermata "+(stop+1)+" di "+session.route.stops.length);}
        else{stopName.setText(session.route.stops.length==0?"Solo percorso GPX":"Capolinea raggiunto");stopDistance.setText(metres(Math.max(0,session.tracker.total()-along))+" al termine");}
    }
    void location(Location p,boolean reliable,double along){lastFix=p;nativeMap.location(p.getLatitude(),p.getLongitude());if(!following||nativeMap.map==null)return;
        if(reliable){double[] a=session.tracker.coordinate(along),b=session.tracker.coordinate(along+40);double r=Math.PI/180,d=(b[1]-a[1])*r;if(GPXTracker.metres(a,b)>10)heading=Math.atan2(Math.sin(d)*Math.cos(b[0]*r),Math.cos(a[0]*r)*Math.sin(b[0]*r)-Math.sin(a[0]*r)*Math.cos(b[0]*r)*Math.cos(d))/r;}
        else if(p.hasBearing()&&p.getSpeed()>3)heading=p.getBearing();
        nativeMap.map.moveCamera(CameraUpdateFactory.newCameraPosition(new CameraPosition.Builder().target(new LatLng(p.getLatitude(),p.getLongitude())).zoom(17).tilt(55).bearing(heading).padding(followPadding.clone()).build()));
    }
    private String metres(double value){return value<1000?((int)Math.max(0,value)/10*10)+" m":String.format(Locale.ITALY,"%.1f km",value/1000);}
    private LinearLayout column(Context c){LinearLayout v=new LinearLayout(c);v.setOrientation(LinearLayout.VERTICAL);return v;}
    private LinearLayout card(Context c,int color){LinearLayout v=new LinearLayout(c);v.setPadding(dp(12),dp(12),dp(12),dp(12));v.setBackground(background(color));v.setElevation(dp(5));return v;}
    private GradientDrawable background(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(24));return d;}
    private TextView label(Context c,String text,int sp,int color,boolean bold){TextView v=new TextView(c);v.setText(text);v.setTextSize(sp);v.setTextColor(color);if(bold)v.setTypeface(Typeface.DEFAULT,Typeface.BOLD);v.setPadding(0,dp(3),0,dp(3));return v;}
    private ImageButton iconButton(Context c,String kind,int color,String description,String tag,Runnable action){ImageButton v=new ImageButton(c);v.setImageDrawable(new NavigationIcon(kind,color));v.setScaleType(ImageView.ScaleType.FIT_CENTER);v.setPadding(dp(12),dp(12),dp(12),dp(12));v.setContentDescription(description);v.setTag(tag);v.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x33007aff),null,background(Color.WHITE)));if(action!=null)v.setOnClickListener(x->action.run());return v;}
    private Button button(Context c,String text,String description,String tag,Runnable action){Button v=new Button(c);v.setText(text);v.setTextSize(16);v.setTextColor(Color.rgb(0,122,255));v.setMinWidth(dp(48));v.setMinimumWidth(dp(48));v.setMinimumHeight(dp(48));v.setPadding(dp(4),0,dp(4),0);v.setAllCaps(false);v.setBackgroundColor(Color.TRANSPARENT);v.setContentDescription(description);v.setTag(tag);if(action!=null)v.setOnClickListener(x->action.run());return v;}
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private static final class BoundedScroll extends ScrollView {int limit=400;void setLimit(int value){if(limit!=value){limit=value;forceLayout();}} BoundedScroll(Context c){super(c);setFillViewport(false);} @Override protected void onMeasure(int w,int h){super.onMeasure(w,MeasureSpec.makeMeasureSpec(limit,MeasureSpec.AT_MOST));}}
}
