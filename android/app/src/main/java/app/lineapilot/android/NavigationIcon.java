package app.lineapilot.android;
import android.graphics.*;
import android.graphics.drawable.Drawable;

// Vector navigation glyphs keep the same visual language as the iOS controls.
final class NavigationIcon extends Drawable {
    private final String kind;private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final int color;
    NavigationIcon(String kind,int color){this.kind=kind;this.color=color;}
    private void line(Canvas c,float... xy){Path p=new Path();p.moveTo(xy[0],xy[1]);for(int i=2;i<xy.length;i+=2)p.lineTo(xy[i],xy[i+1]);c.drawPath(p,paint);}
    @Override public void draw(Canvas canvas){canvas.save();canvas.translate(getBounds().left,getBounds().top);canvas.scale(getBounds().width()/24f,getBounds().height()/24f);paint.setColor(color);paint.setStrokeWidth(2.2f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);paint.setStyle(Paint.Style.STROKE);
        switch(kind){
            case "sound":case "muted":{Path speaker=new Path();speaker.moveTo(3,9);speaker.lineTo(7,9);speaker.lineTo(12,5);speaker.lineTo(12,19);speaker.lineTo(7,15);speaker.lineTo(3,15);speaker.close();paint.setStyle(Paint.Style.FILL);canvas.drawPath(speaker,paint);paint.setStyle(Paint.Style.STROKE);if(kind.equals("sound")){canvas.drawArc(new RectF(6,2,22,22),-55,110,false,paint);canvas.drawArc(new RectF(8,6,18,18),-50,100,false,paint);}else{line(canvas,17,9,22,15);line(canvas,22,9,17,15);}break;}
            case "location":{Path p=new Path();p.moveTo(21,3);p.lineTo(14,21);p.lineTo(10,14);p.lineTo(3,10);p.close();paint.setStyle(Paint.Style.FILL);canvas.drawPath(p,paint);break;}
            case "fit":line(canvas,4,10,4,4,10,4);line(canvas,4,4,10,10);line(canvas,20,14,20,20,14,20);line(canvas,20,20,14,14);break;
            case "north":paint.setColor(Color.GRAY);canvas.drawCircle(12,12,10,paint);paint.setColor(Color.RED);paint.setStyle(Paint.Style.FILL);Path n=new Path();n.moveTo(12,3);n.lineTo(16,15);n.lineTo(12,12);n.lineTo(8,15);n.close();canvas.drawPath(n,paint);break;
            case "roundabout":canvas.drawArc(new RectF(5,5,19,19),-80,300,false,paint);line(canvas,4,5,10,4,9,10);break;
            case "left":canvas.scale(-1,1,12,12);
            case "right":{Path p=new Path();p.moveTo(5,21);p.lineTo(5,10);p.quadTo(5,6,9,6);p.lineTo(20,6);canvas.drawPath(p,paint);line(canvas,15,1,20,6,15,11);break;}
            case "warning":line(canvas,12,3,22,21,2,21,12,3);line(canvas,12,9,12,14);canvas.drawPoint(12,18,paint);break;
            default:line(canvas,12,21,12,3);line(canvas,5,10,12,3,19,10);
        }
        canvas.restore();
    }
    @Override public void setAlpha(int alpha){paint.setAlpha(alpha);}
    @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
