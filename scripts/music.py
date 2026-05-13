import os
import requests
import psycopg2
from datetime import datetime

# Configurazione
API_KEY = os.getenv('LASTFM_API_KEY')
USER = os.getenv('LASTFM_USER')
DATABASE_URL = os.getenv('DATABASE_URL')

def fetch_lastfm_data():
    # Recupera l'ultimo report settimanale (Weekly Chart)
    url = f"http://ws.audioscrobbler.com/2.0/?method=user.getweeklyartistchart&user={USER}&api_key={API_KEY}&format=json"
    response = requests.get(url).json()
    
    if 'weeklyartistchart' not in response:
        raise Exception("Errore nel recupero dati da Last.fm")
        
    artists = response['weeklyartistchart']['artist']
    
    # Calcolo totale scrobbles e minuti (media 3.5 min)
    total_scrobbles = sum(int(a['playcount']) for a in artists)
    total_minutes = int(total_scrobbles * 3.5)
    
    return total_scrobbles, total_minutes, artists

def save_to_db(scrobbles, minutes, artists):
    # Connessione con SSL (come nel tuo script Node)
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    cur = conn.cursor()
    today = datetime.now()
    
    try:
        # Inserimento tabella Short (music_reports) con controllo duplicati
        # Usiamo ON CONFLICT per evitare doppie notifiche se lo script gira due volte lo stesso giorno
        query_report = """
            INSERT INTO music_reports (report_date, total_minutes, total_scrobbles, year, month) 
            VALUES (%s, %s, %s, %s, %s) 
            ON CONFLICT (report_date) DO NOTHING
            RETURNING id;
        """
        cur.execute(query_report, (today.date(), minutes, scrobbles, today.year, today.month))
        result = cur.fetchone()

        if result:
            report_id = result[0]
            print(f"✅ Nuovo report inserito: ID {report_id}")

            # Inserimento Top 5 Artisti (Details)
            for i, artist in enumerate(artists[:5]):
                cur.execute(
                    "INSERT INTO music_report_details (report_id, item_type, item_name, play_count, rank) VALUES (%s, %s, %s, %s, %s)",
                    (report_id, 'artist', artist['name'], int(artist['playcount']), i+1)
                )
            
            # --- INSERIMENTO NOTIFICA ---
            notification_msg = f"Report musicale settimanale pronto: {scrobbles} brani ascoltati ({minutes} min)."
            cur.execute(
                "INSERT INTO notifications (category, message) VALUES (%s, %s)",
                ('MUSIC', notification_msg)
            )
            print("🔔 Notifica creata con successo.")
            
        else:
            print("ℹ️ Report già esistente per questa data. Saltato.")

        conn.commit()
    except Exception as e:
        print(f"❌ Errore durante il salvataggio: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    try:
        s, m, a = fetch_lastfm_data()
        save_to_db(s, m, a)
    except Exception as e:
        print(f"❌ Errore script Music: {e}")