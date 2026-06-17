-- RESET DA PLATAFORMA FF ARENA
-- Executa este script no MySQL do Railway para zerar tudo.
-- Mantém: utilizadores, passwords, configurações da plataforma.

-- Zerar saldo e estatísticas de todos os jogadores
UPDATE users SET balanceCents=0, pendingCents=0, totalEarningsCents=0, wins=0, losses=0 WHERE isAdmin=0;

-- Apagar histórico financeiro
DELETE FROM transactions;
DELETE FROM withdrawals;
DELETE FROM mbway_topups;

-- Apagar salas e mensagens
DELETE FROM rooms;
DELETE FROM room_messages;

-- Apagar denúncias e notificações
DELETE FROM reports;
DELETE FROM notifications;
