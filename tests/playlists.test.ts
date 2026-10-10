import { describe, expect, it } from 'vitest';
import { csvRows, entryLabel, matchEntry, matchPlaylist, normTitle, parsePlaylistFile, parseXml, pathFileName, splitArtistTitle, type MatchTarget } from '../src/library/playlists';

const lib: MatchTarget[] = [
  { id: 't1', fileName: 'Night Drive.mp3', title: 'Night Drive', artist: 'Mara Lune' },
  { id: 't2', fileName: '02 - Ocean Floor (Original Mix).flac', title: 'Ocean Floor', artist: 'Kento & Bell' },
  { id: 't3', fileName: 'warehouse_tool.wav', title: 'warehouse_tool.wav', artist: '' },
  { id: 't4', fileName: 'Sunrise.m4a', title: 'Sunrise', artist: 'Other Artist' },
  { id: 't5', fileName: 'Sunrise (Extended).mp3', title: 'Sunrise', artist: 'DJ Halo' },
];

describe('playlist files', () => {
  it('reads M3U with #EXTINF names and paths, and a #PLAYLIST title', () => {
    const [p] = parsePlaylistFile('club.m3u8', '#EXTM3U\n#PLAYLIST:Friday\n#EXTINF:312,Mara Lune - Night Drive\n/Users/me/Music/Night Drive.mp3\n\nC:\\Music\\warehouse_tool.wav\n');
    expect(p.name).toBe('Friday');
    expect(p.entries).toEqual([
      { artist: 'Mara Lune', title: 'Night Drive', path: '/Users/me/Music/Night Drive.mp3' },
      { path: 'C:\\Music\\warehouse_tool.wav' },
    ]);
  });

  it('reads PLS in its numbered order', () => {
    const [p] = parsePlaylistFile('set.pls', '[playlist]\nFile2=b.mp3\nTitle2=B - Two\nFile1=a.mp3\nTitle1=A - One\nNumberOfEntries=2\n');
    expect(p.name).toBe('set');
    expect(p.entries.map(entryLabel)).toEqual(['A – One', 'B – Two']);
  });

  it('reads XSPF', () => {
    const xml = `<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>Late &amp; Deep</title><trackList>
      <track><location>file:///home/me/Night%20Drive.mp3</location><title>Night Drive</title><creator>Mara Lune</creator></track>
    </trackList></playlist>`;
    const [p] = parsePlaylistFile('x.xspf', xml);
    expect(p.name).toBe('Late & Deep');
    expect(p.entries[0]).toEqual({ title: 'Night Drive', artist: 'Mara Lune', path: 'file:///home/me/Night%20Drive.mp3' });
    expect(matchPlaylist(p, lib).ids).toEqual(['t1']);
  });

  it('reads rekordbox XML playlists, in folders, by track ID or location', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox"/>
      <COLLECTION Entries="2">
        <TRACK TrackID="7" Name="Night Drive" Artist="Mara Lune" Location="file://localhost/Users/me/Night%20Drive.mp3"/>
        <TRACK TrackID="9" Name="Ocean Floor" Artist="Kento" Location="file://localhost/Users/me/x.flac"/>
      </COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1">
        <NODE Type="0" Name="Gigs" Count="1">
          <NODE Name="Peak" Type="1" KeyType="0" Entries="2"><TRACK Key="9"/><TRACK Key="7"/></NODE>
        </NODE>
        <NODE Name="By location" Type="1" KeyType="1" Entries="1"><TRACK Key="file://localhost/Users/me/Night%20Drive.mp3"/></NODE>
      </NODE></PLAYLISTS></DJ_PLAYLISTS>`;
    const pls = parsePlaylistFile('rekordbox.xml', xml);
    expect(pls.map((p) => p.name)).toEqual(['Peak', 'By location']);
    expect(pls[0].entries.map((e) => e.title)).toEqual(['Ocean Floor', 'Night Drive']);
    expect(matchPlaylist(pls[0], lib).ids).toEqual(['t2', 't1']);
    expect(pls[1].entries[0].title).toBe('Night Drive');
  });

  it('reads Traktor NML playlists', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?><NML VERSION="19"><COLLECTION ENTRIES="1">
      <ENTRY TITLE="Night Drive" ARTIST="Mara Lune"><LOCATION DIR="/:Users/:me/:Music/:" FILE="Night Drive.mp3" VOLUME="Macintosh HD"></LOCATION></ENTRY>
      </COLLECTION><PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="2">
        <NODE TYPE="PLAYLIST" NAME="Warm up"><PLAYLIST ENTRIES="1" TYPE="LIST"><ENTRY><PRIMARYKEY TYPE="TRACK" KEY="Macintosh HD/:Users/:me/:Music/:Night Drive.mp3"></PRIMARYKEY></ENTRY></PLAYLIST></NODE>
        <NODE TYPE="PLAYLIST" NAME="_LOOPS"><PLAYLIST ENTRIES="0" TYPE="LIST"></PLAYLIST></NODE>
      </SUBNODES></NODE></PLAYLISTS></NML>`;
    const pls = parsePlaylistFile('collection.nml', xml);
    expect(pls).toHaveLength(1);
    expect(pls[0].name).toBe('Warm up');
    expect(pls[0].entries[0]).toEqual({ title: 'Night Drive', artist: 'Mara Lune', path: 'Macintosh HD/Users/me/Music/Night Drive.mp3' });
    expect(matchPlaylist(pls[0], lib).ids).toEqual(['t1']);
  });

  it('reads an Apple Music / iTunes library export, skipping the built-in lists', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
      <key>Tracks</key><dict>
        <key>101</key><dict><key>Track ID</key><integer>101</integer><key>Name</key><string>Night Drive</string><key>Artist</key><string>Mara Lune</string></dict>
        <key>102</key><dict><key>Track ID</key><integer>102</integer><key>Name</key><string>Sunrise</string><key>Artist</key><string>DJ Halo</string></dict>
      </dict>
      <key>Playlists</key><array>
        <dict><key>Name</key><string>Library</string><key>Master</key><true/><key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array></dict>
        <dict><key>Name</key><string>Sunday</string><key>Playlist Items</key><array><dict><key>Track ID</key><integer>102</integer></dict><dict><key>Track ID</key><integer>101</integer></dict></array></dict>
      </array></dict></plist>`;
    const pls = parsePlaylistFile('Library.xml', xml);
    expect(pls.map((p) => p.name)).toEqual(['Sunday']);
    // "Sunrise" by DJ Halo, not the other Sunrise
    expect(matchPlaylist(pls[0], lib).ids).toEqual(['t5', 't1']);
  });

  it('reads CSV exports of streaming playlists, grouped by playlist when there is a column for it', () => {
    const exportify = 'Track URI,Track Name,Artist URI(s),Artist Name(s),Album Name\nspotify:track:1,Night Drive,spotify:artist:9,"Mara Lune, Someone",X\nspotify:track:2,"Ocean Floor - Original Mix",u,Kento,Y\n';
    const [p] = parsePlaylistFile('My Spotify Playlist.csv', exportify);
    expect(p.name).toBe('My Spotify Playlist');
    // "Ocean Floor - Original Mix" by Kento is the "Ocean Floor (Original Mix)" by Kento & Bell on disk
    expect(matchPlaylist(p, lib).ids).toEqual(['t1', 't2']);
    const grouped = 'Track name,Artist name,Album,Playlist name\nNight Drive,Mara Lune,A,Deep\nSunrise,DJ Halo,B,Peak\nOcean Floor,Kento,C,Deep\n';
    const pls = parsePlaylistFile('export.csv', grouped);
    expect(pls.map((x) => [x.name, x.entries.length])).toEqual([
      ['Deep', 2],
      ['Peak', 1],
    ]);
    expect(matchPlaylist(pls[0], lib).ids).toEqual(['t1', 't2']);
  });

  it('reads plain track lists, numbered or bulleted, and skips links', () => {
    const [p] = parsePlaylistFile('list.txt', '1. Mara Lune - Night Drive\n2) Ocean Floor by Kento\n• warehouse_tool\nhttps://example.com/track/1\n');
    expect(p.entries).toEqual([{ artist: 'Mara Lune', title: 'Night Drive' }, { title: 'Ocean Floor', artist: 'Kento' }, { title: 'warehouse_tool' }]);
    expect(matchPlaylist(p, lib)).toEqual({ ids: ['t1', 't2', 't3'], missing: [] });
  });
});

describe('matching a playlist to your files', () => {
  it('normalises titles and file paths', () => {
    expect(normTitle('Ocean Floor (Original Mix)')).toBe('ocean floor');
    expect(normTitle('Café del Mar feat. Someone')).toBe('cafe del mar');
    expect(pathFileName('file://localhost/Users/me/Night%20Drive.mp3')).toBe('night drive.mp3');
    expect(pathFileName('C:\\Music\\A.mp3')).toBe('a.mp3');
    expect(splitArtistTitle('A — B')).toEqual({ artist: 'A', title: 'B' });
  });

  it('needs the artist to agree when two tracks share a title, and reports what is missing', () => {
    expect(matchEntry({ title: 'Sunrise' }, lib)).toBeNull();
    expect(matchEntry({ title: 'Sunrise', artist: 'Other Artist' }, lib)).toBe('t4');
    expect(matchEntry({ title: 'Sunrise', artist: 'Nobody' }, lib)).toBeNull();
    const r = matchPlaylist({ name: 'x', entries: [{ title: 'Night Drive', artist: 'Mara Lune' }, { title: 'Not Here', artist: 'Anyone' }, { title: 'Night Drive', artist: 'Mara Lune' }] }, lib);
    expect(r.ids).toEqual(['t1']);
    expect(r.missing.map(entryLabel)).toEqual(['Anyone – Not Here']);
  });

  it('parses CSV quoting and XML entities', () => {
    expect(csvRows('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    const x = parseXml('<a x="1 &amp; 2"><b>caf&#233;</b><c/></a>');
    expect(x.children[0].attrs.x).toBe('1 & 2');
    expect(x.children[0].children[0].text).toBe('café');
    expect(x.children[0].children[1].name).toBe('c');
  });
});
