package com.nexvia.crm;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS → SharedPreferences → 홈 화면 위젯 갱신 브리지.
 */
@CapacitorPlugin(name = "CalendarWidget")
public class CalendarWidgetPlugin extends Plugin {

    @PluginMethod
    public void updateEvents(PluginCall call) {
        String payload = call.getString("payload", null);
        if (payload == null || payload.trim().isEmpty()) {
            JSObject asObject = call.getObject("payload", null);
            if (asObject != null) {
                payload = asObject.toString();
            }
        }
        if (payload == null || payload.trim().isEmpty()) {
            call.reject("payload is required");
            return;
        }
        CalendarWidgetStore.savePayload(getContext(), payload);
        CalendarWidgetProvider.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clearEvents(PluginCall call) {
        CalendarWidgetStore.savePayload(getContext(), CalendarWidgetStore.emptyPayload().toString());
        CalendarWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
