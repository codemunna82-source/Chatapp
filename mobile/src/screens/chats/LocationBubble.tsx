import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * A shared place, drawn as a card rather than printed as coordinates.
 *
 * The app used to render these as whatever one-line text the server built
 * for previews — "Location (22.594133, 88.393396)" in a plain bubble.
 * That is the raw data, not a place: an agent could not tell at a glance
 * where a customer was, and tapping it did nothing.
 *
 * The surface behind the pin is a DRAWN abstraction, not a map of these
 * coordinates. No tiles are fetched and none could be without handing a
 * third-party map host every customer's location along with it. A picture
 * that looked like the real streets around the pin while being generated
 * from nothing would be worse than no picture, so this one is
 * unmistakably a graphic: flat bands, no labels, no scale. The same card
 * the customer's own web window draws, so both sides agree.
 *
 * What it is honest about is where the place is: the coordinates are
 * printed underneath, and tapping opens the phone's real map app, which
 * does have the tiles.
 */
export function LocationBubble({
  place,
  onLongPress,
}: {
  place: SharedLocation;
  onLongPress?: () => void;
}) {
  const { colors, radius, typography } = useTheme();
  const label = place.name?.trim() || 'Shared location';
  const coords = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;

  const open = () => {
    // geo: is the native handler and lets Android offer every installed
    // map app rather than forcing one. The https form is the fallback for
    // a device with no geo: handler at all, where geo: would silently do
    // nothing — which is indistinguishable from a broken card.
    const geo = `geo:${place.latitude},${place.longitude}?q=${place.latitude},${place.longitude}(${encodeURIComponent(label)})`;
    const web = `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
    void (Platform.OS === 'android'
      ? Linking.openURL(geo).catch(() => Linking.openURL(web))
      : Linking.openURL(web));
  };

  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, open in maps`}
      style={[styles.card, { borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.map}>
        {/* Bands, not a street grid: a grid invites the eye to read it as
            a real place. These read as "map-ish surface" and no more. */}
        <View style={[styles.band, styles.bandA]} />
        <View style={[styles.band, styles.bandB]} />
        <View style={styles.blobA} />
        <View style={styles.blobB} />
        <Ionicons name="location" size={30} color="#E0483D" style={styles.pin} />
      </View>

      <View style={styles.footer}>
        <View style={styles.labelRow}>
          <Ionicons name="location-outline" size={14} color={colors.primary} />
          <Text
            style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: 5, flex: 1 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        {/* Room on the right for the timestamp the bubble draws over this
            strip — without it the address runs underneath it. */}
        <Text
          style={[typography.caption, { color: colors.textSecondary, marginTop: 1, paddingRight: 52 }]}
          numberOfLines={1}
        >
          {place.address?.trim() || coords}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: 232, overflow: 'hidden' },
  map: { height: 118, width: '100%', backgroundColor: '#CFE0D2', overflow: 'hidden' },
  band: { position: 'absolute', backgroundColor: '#FFFFFF', opacity: 0.7 },
  bandA: { height: 9, width: 300, top: 52, left: -20, transform: [{ rotate: '-24deg' }] },
  bandB: { height: 6, width: 300, top: 86, left: -40, transform: [{ rotate: '32deg' }], opacity: 0.5 },
  blobA: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#B7D3BD',
    opacity: 0.75,
    left: 8,
    top: 70,
  },
  blobB: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#B7D3BD',
    opacity: 0.6,
    right: 10,
    top: 82,
  },
  pin: { position: 'absolute', left: 101, top: 38 },
  footer: { paddingHorizontal: 9, paddingTop: 6, paddingBottom: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
});
