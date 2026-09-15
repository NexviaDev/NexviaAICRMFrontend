package com.nexvia.crm;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 홈 화면 캘린더 위젯 — 앱에서 동기화한 오늘 일정을 표시합니다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {
    private static final int[] ROW_IDS = {
            R.id.widget_row_0,
            R.id.widget_row_1,
            R.id.widget_row_2,
            R.id.widget_row_3,
            R.id.widget_row_4
    };
    private static final int[] TIME_IDS = {
            R.id.widget_row_0_time,
            R.id.widget_row_1_time,
            R.id.widget_row_2_time,
            R.id.widget_row_3_time,
            R.id.widget_row_4_time
    };
    private static final int[] TITLE_IDS = {
            R.id.widget_row_0_title,
            R.id.widget_row_1_title,
            R.id.widget_row_2_title,
            R.id.widget_row_3_title,
            R.id.widget_row_4_title
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.calendar_widget);
        JSONObject payload = CalendarWidgetStore.parsePayload(context);

        String header = payload.optString("header", "");
        String subtitle = payload.optString("subtitle", "");
        if (header == null || header.trim().isEmpty()) {
            header = context.getString(R.string.calendar_widget_title);
        }
        if (subtitle == null || subtitle.trim().isEmpty()) {
            subtitle = context.getString(R.string.calendar_widget_subtitle_default);
        }
        views.setTextViewText(R.id.widget_title, header);
        views.setTextViewText(R.id.widget_subtitle, subtitle);

        JSONArray events = payload.optJSONArray("events");
        int count = events == null ? 0 : Math.min(events.length(), CalendarWidgetStore.MAX_EVENTS);
        for (int i = 0; i < ROW_IDS.length; i++) {
            if (i < count) {
                JSONObject ev = events.optJSONObject(i);
                String time = ev != null ? ev.optString("time", "") : "";
                String title = ev != null ? ev.optString("title", "") : "";
                if (time == null || time.trim().isEmpty()) time = "종일";
                if (title == null || title.trim().isEmpty()) title = "(제목 없음)";
                views.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                views.setTextViewText(TIME_IDS[i], time);
                views.setTextViewText(TITLE_IDS[i], title);
            } else {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        }
        views.setViewVisibility(R.id.widget_empty, count == 0 ? View.VISIBLE : View.GONE);
        if (count == 0) {
            boolean hasCache = payload.optLong("updatedAt", 0) > 0;
            views.setTextViewText(
                    R.id.widget_empty,
                    context.getString(hasCache
                            ? R.string.calendar_widget_empty_today
                            : R.string.calendar_widget_empty)
            );
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.putExtra(MainActivity.EXTRA_LAUNCH_PATH, "/calendar");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                context,
                appWidgetId,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pi);
        views.setOnClickPendingIntent(R.id.widget_header, pi);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /** 모든 위젯 인스턴스를 캐시 기준으로 다시 그립니다. */
    public static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, CalendarWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids == null || ids.length == 0) return;
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
