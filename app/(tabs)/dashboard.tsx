import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  Switch,
  AppState,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { getItem, setItem, deleteItem } from '@/utils/storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const API_BASE = 'http://192.168.50.75:3000';

interface NotificationLog {
  id: string;
  requestId: string | null;
  title: string;
  body: string;
  receivedAt: Date;
}

function parseNotificationBody(body: string): { name: string; pickup: string; dropoff: string } | null {
  const dashIdx = body.indexOf(' — ');
  const arrowIdx = body.indexOf(' → ');
  if (dashIdx === -1 || arrowIdx === -1) return null;
  return {
    name: body.slice(0, dashIdx),
    pickup: body.slice(dashIdx + 3, arrowIdx),
    dropoff: body.slice(arrowIdx + 3),
  };
}

export default function DashboardScreen() {
  const [registered, setRegistered] = useState(false);
  const [available, setAvailable] = useState(true);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const foregroundListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const seenRequestIdsRef = useRef<Set<string>>(new Set());
  const logsRef = useRef<NotificationLog[]>([]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Keep logsRef in sync so filterStaleLogs can read current state asynchronously
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    setupNotifications();

    if (Platform.OS === 'web') return;

    foregroundListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        const requestId = (notification.request.content.data?.requestId as string) ?? null;

        // Skip if we've already logged this request
        if (requestId && seenRequestIdsRef.current.has(requestId)) return;
        if (requestId) seenRequestIdsRef.current.add(requestId);

        setLogs((prev) => [
          {
            id: notification.request.identifier,
            requestId,
            title: notification.request.content.title ?? 'Ride Request',
            body: notification.request.content.body ?? '',
            receivedAt: new Date(),
          },
          ...prev.slice(0, 19),
        ]);
      }
    );

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') filterStaleLogs();
    });

    return () => {
      foregroundListenerRef.current?.remove();
      appStateSub.remove();
    };
  }, []);

  async function filterStaleLogs() {
    const currentLogs = logsRef.current;
    const requestIds = currentLogs
      .map((l) => l.requestId)
      .filter((id): id is string => id !== null);

    if (requestIds.length === 0) return;

    try {
      const cookie = await getItem('session-cookie');
      if (!cookie) return;

      const res = await fetch(
        `${API_BASE}/api/request-status?ids=${requestIds.join(',')}`,
        { headers: { Cookie: cookie } }
      );
      if (!res.ok) return;

      const { pendingIds } = await res.json() as { pendingIds: string[] };
      const pendingSet = new Set(pendingIds);

      // Remove stale IDs from the seen set so they can be re-shown if reposted
      for (const id of seenRequestIdsRef.current) {
        if (!pendingSet.has(id)) seenRequestIdsRef.current.delete(id);
      }

      setLogs((prev) => prev.filter((l) => !l.requestId || pendingSet.has(l.requestId)));
    } catch {
      // Silently fail — don't disrupt UX
    }
  }

  async function setupNotifications() {
    const cookie = await getItem('session-cookie');
    if (!cookie) {
      router.replace('/');
      return;
    }

    if (Platform.OS === 'web' || !Device.isDevice) {
      setRegistered(false);
      return;
    }

    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        Alert.alert(
          'Notifications Disabled',
          'Enable notifications in Settings to receive ride requests.'
        );
        setRegistered(false);
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('ride-requests', {
          name: 'Ride Requests',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#2563EB',
          sound: 'default',
        });
      }

      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

      const tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );

      const token = tokenData.data;
      setPushToken(token);

      const stored = await getItem('driver-available');
      const isAvailable = stored !== 'false';
      setAvailable(isAvailable);

      if (isAvailable) {
        await fetch(`${API_BASE}/api/push-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ token }),
        });
        setRegistered(true);
        filterStaleLogs();
      }
    } catch (err) {
      console.error('[dashboard] Notification setup failed:', err);
      setRegistered(false);
    }
  }

  async function handleToggleAvailability(value: boolean) {
    if (!pushToken) return;

    const cookie = await getItem('session-cookie');
    if (!cookie) return;

    setAvailable(value);
    await setItem('driver-available', value ? 'true' : 'false');

    if (value) {
      await fetch(`${API_BASE}/api/push-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ token: pushToken }),
      }).catch(() => {});
      setRegistered(true);
      filterStaleLogs();
    } else {
      await fetch(`${API_BASE}/api/push-token`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ token: pushToken }),
      }).catch(() => {});
      setRegistered(false);
    }
  }

  async function handleLogout() {
    try {
      const cookie = await getItem('session-cookie');
      if (cookie && pushToken) {
        await fetch(`${API_BASE}/api/push-token`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ token: pushToken }),
        }).catch(() => {});
      }
    } finally {
      await deleteItem('session-cookie');
      await deleteItem('driver-available');
      router.replace('/');
    }
  }

  const isActive = registered && available;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="car-sport" size={18} color="#fff" />
          </View>
          <Text style={styles.title}>BaseBound Driver</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={16} color="#EF4444" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status card */}
        <View style={styles.statusCard}>
          <View style={styles.statusLeft}>
            <View style={[styles.dot, isActive ? styles.dotGreen : styles.dotOrange]} />
            <View style={styles.statusTextWrapper}>
              <Text style={styles.statusMain}>
                {isActive
                  ? 'Active — Listening for ride requests'
                  : !available
                  ? 'Unavailable — notifications paused'
                  : 'Notifications not active'}
              </Text>
              {available && !registered && (
                <Text style={styles.statusHint}>
                  Grant notification permissions and use a physical device.
                </Text>
              )}
            </View>
          </View>
          <Switch
            value={available}
            onValueChange={handleToggleAvailability}
            trackColor={{ false: '#D1D5DB', true: '#4F46E5' }}
            thumbColor="#fff"
            disabled={!pushToken}
          />
        </View>

        {/* Recent notifications */}
        <Text style={styles.sectionLabel}>Recent Notifications</Text>

        {logs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="notifications-off-outline" size={32} color="#D1D5DB" />
            <Text style={styles.emptyText}>No notifications received yet</Text>
          </View>
        ) : (
          logs.map((log) => {
            const parsed = parseNotificationBody(log.body);
            return (
              <View key={log.id} style={styles.logCard}>
                {/* Indigo header banner */}
                <View style={styles.logCardBanner}>
                  <View style={styles.logBannerLeft}>
                    <Ionicons name="car-sport" size={13} color="#fff" />
                    <Text style={styles.logBannerTitle}>{log.title}</Text>
                  </View>
                  <Text style={styles.logBannerTime}>{log.receivedAt.toLocaleTimeString()}</Text>
                </View>

                {/* Card body */}
                <View style={styles.logCardBody}>
                  {parsed ? (
                    <View style={styles.logTwoCol}>
                      <View style={styles.logPassengerCol}>
                        <Text style={styles.logPassengerName}>{parsed.name}</Text>
                      </View>
                      <View style={styles.logLocationsCol}>
                        <View style={styles.logLocation}>
                          <View style={[styles.locationDot, styles.locationDotGreen]} />
                          <Text style={styles.locationText} numberOfLines={1}>{parsed.pickup}</Text>
                        </View>
                        <View style={styles.logLocation}>
                          <View style={[styles.locationDot, styles.locationDotRed]} />
                          <Text style={styles.locationText} numberOfLines={1}>{parsed.dropoff}</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.logBody}>{log.body}</Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
  },
  logoutText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 12,
    marginRight: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
    flexShrink: 0,
  },
  dotGreen: { backgroundColor: '#22C55E' },
  dotOrange: { backgroundColor: '#F97316' },
  statusTextWrapper: { flex: 1 },
  statusMain: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  statusHint: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 15,
  },
  logCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  logCardBanner: {
    backgroundColor: '#4F46E5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  logBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  logBannerTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  logBannerTime: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
  },
  logCardBody: {
    padding: 12,
  },
  logTwoCol: {
    flexDirection: 'row',
    gap: 12,
  },
  logPassengerCol: {
    flex: 1,
    justifyContent: 'center',
  },
  logPassengerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  logLocationsCol: {
    flex: 1,
    gap: 6,
  },
  logLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  locationDotGreen: { backgroundColor: '#22C55E' },
  locationDotRed: { backgroundColor: '#EF4444' },
  locationText: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  logBody: {
    fontSize: 13,
    color: '#374151',
  },
});
