import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getItem, setItem } from '@/utils/storage';

const API_BASE = 'https://basebound.travisspark.com';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // If a session cookie is already stored, go straight to dashboard
    getItem('session-cookie').then((cookie) => {
      if (cookie) {
        router.replace('/dashboard');
      } else {
        setChecking(false);
      }
    });
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Email and password are required.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/mobile-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert('Login Failed', data.error ?? 'Invalid credentials.');
        return;
      }

      // The server returns the Set-Cookie header value in the body so we can
      // store it without relying on native Set-Cookie header parsing.
      const rawCookie: string = data.cookie ?? '';
      const cookieValue = rawCookie.split(';')[0]; // "session-cookie=<value>"

      if (!cookieValue.startsWith('session-cookie=')) {
        Alert.alert('Error', 'Unexpected session format. Please try again.');
        return;
      }

      await setItem('session-cookie', cookieValue);
      router.replace('/dashboard');
    } catch {
      Alert.alert('Network Error', 'Could not reach the server. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Rideshare Driver</Text>
        <Text style={styles.subtitle}>Sign in to receive ride notifications</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: '#111827',
    marginBottom: 12,
    backgroundColor: '#f9fafb',
  },
  button: {
    backgroundColor: '#1a56db',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
