import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { getItem, deleteItem } from '@/utils/storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const API_BASE = 'https://basebound.travisspark.com';

interface NotificationLog {
  id: string;
  title: string;
  body: string;
  receivedAt: Date;
}

export default function DashboardScreen() {
  const [registered, setRegistered] = useState(false);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const foregroundListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setupNotifications();

    if (Platform.OS === 'web') return;

    // Log notifications received while the app is in the foreground
    foregroundListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        setLogs((prev) => [
          {
            id: notification.request.identifier,
            title: notification.request.content.title ?? 'Ride Request',
            body: notification.request.content.body ?? '',
            receivedAt: new Date(),
          },
          ...prev.slice(0, 19), // keep the last 20
        ]);
      }
    );

    return () => {
      foregroundListenerRef.current?.remove();
    };
  }, []);

  async function setupNotifications() {
    const cookie = await getItem('session-cookie');
    if (!cookie) {
      router.replace('/');
      return;
    }

    if (Platform.OS === 'web' || !Device.isDevice) {
      // Simulators don't support push notifications
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
          lightColor: '#1a56db',
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

      await fetch(`${API_BASE}/api/push-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ token }),
      });

      setRegistered(true);
    } catch (err) {
      console.error('[dashboard] Notification setup failed:', err);
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
      router.replace('/');
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Rideshare Driver</Text>
        <TouchableOpacity onPress={handleLogout} hitSlop={12}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Status card */}
      <View style={styles.statusCard}>
        <View style={[styles.dot, registered ? styles.dotGreen : styles.dotOrange]} />
        <View style={styles.statusTextWrapper}>
          <Text style={styles.statusMain}>
            {registered ? 'Active — Listening for ride requests' : 'Notifications not active'}
          </Text>
          {!registered && (
            <Text style={styles.statusHint}>
              Grant notification permissions and use a physical device.
            </Text>
          )}
        </View>
      </View>

      {/* Recent notifications */}
      <Text style={styles.sectionLabel}>Recent Notifications</Text>
      <ScrollView
        style={styles.logScroll}
        contentContainerStyle={logs.length === 0 ? styles.emptyContainer : undefined}
        showsVerticalScrollIndicator={false}
      >
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>No notifications received yet.</Text>
        ) : (
          logs.map((log) => (
            <View key={log.id} style={styles.logCard}>
              <Text style={styles.logTitle}>{log.title}</Text>
              <Text style={styles.logBody}>{log.body}</Text>
              <Text style={styles.logTime}>{log.receivedAt.toLocaleTimeString()}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '500',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 14,
    marginBottom: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
  },
  dotGreen: { backgroundColor: '#22c55e' },
  dotOrange: { backgroundColor: '#f97316' },
  statusTextWrapper: { flex: 1 },
  statusMain: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  statusHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  logScroll: {
    flex: 1,
    paddingHorizontal: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 40,
  },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  logBody: {
    fontSize: 14,
    color: '#374151',
    marginTop: 3,
  },
  logTime: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 6,
  },
});
